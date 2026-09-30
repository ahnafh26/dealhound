import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttpState } from '@/lib/http';
import { resolveRegion } from '@/lib/region';
import { runSource } from '@/lib/search';
import { kijiji, kijijiSearchUrl, parseKijijiPage } from '@/lib/sources/kijiji';
import { passthroughSpec } from '@/lib/spec';
import { fanOutOptions } from '../helpers';

const fixture = readFileSync('fixtures/kijiji/search.html', 'utf8');
const ontario = resolveRegion('CA', 'M5V 3L9');

beforeEach(() => resetHttpState());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseKijijiPage', () => {
  const listings = parseKijijiPage(fixture, ontario) ?? [];

  it('reads organic, fixed-price listings from the embedded data', () => {
    expect(listings.map((l) => l.id)).toEqual(['kijiji:1720000001', 'kijiji:1720000002', 'kijiji:1720000005']);
  });

  it('converts cents, makes URLs absolute, and trims the postal code', () => {
    expect(listings[0]).toMatchObject({
      price: 1050,
      shipping: 0,
      channel: 'local-marketplace',
      url: 'https://www.kijiji.ca/v-laptops/city-of-toronto/macbook-air-m4-13-16gb-256gb/1720000001',
      location: 'Toronto, ON',
      imageCount: 5,
      postedAt: '2026-09-26T15:20:00.000Z',
      description: 'Bought in April, used lightly. Comes with box and charger. AppleCare+ until 2028.',
    });
  });

  it("maps Kijiji's condition attribute", () => {
    expect(listings.map((l) => l.condition)).toEqual(['used-excellent', 'new', 'used-good']);
  });

  it('returns null for a page without listing data, like a block page', () => {
    expect(parseKijijiPage('<html><body>Access denied</body></html>', ontario)).toBeNull();
  });
});

describe('kijijiSearchUrl', () => {
  it("searches Buy & Sell in the shopper's province", () => {
    expect(kijijiSearchUrl('MacBook Air M4', ontario)).toBe(
      'https://www.kijiji.ca/b-buy-sell/ontario/macbook-air-m4/k0c10l9004',
    );
    expect(kijijiSearchUrl('Sony WH-1000XM5', resolveRegion('CA', 'H2X 1Y4'))).toBe(
      'https://www.kijiji.ca/b-buy-sell/quebec/sony-wh-1000xm5/k0c10l9001',
    );
  });

  it('takes a location override', () => {
    vi.stubEnv('KIJIJI_LOCATION', 'city-of-toronto/1700273');
    expect(kijijiSearchUrl('switch 2', ontario)).toBe('https://www.kijiji.ca/b-buy-sell/city-of-toronto/switch-2/k0c10l1700273');
  });
});

describe('kijiji adapter', () => {
  it('is off unless enabled', () => {
    expect(kijiji.enabled()).toBe(false);
    vi.stubEnv('KIJIJI_ENABLED', '1');
    expect(kijiji.enabled()).toBe(true);
  });

  it('backs off after a block page', async () => {
    vi.stubEnv('KIJIJI_ENABLED', '1');
    const fetchMock = vi.fn(async () => new Response('<html>Access denied</html>'));
    vi.stubGlobal('fetch', fetchMock);
    const opts = fanOutOptions({ region: ontario });

    const first = await runSource(kijiji, passthroughSpec('MacBook Air M4'), opts);
    const second = await runSource(kijiji, passthroughSpec('Sony XM5'), opts);

    expect(first.status.state).toBe('error');
    expect(second.status.detail).toMatch(/resting/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replays its fixture offline', async () => {
    vi.stubEnv('USE_FIXTURES', '1');
    const outcome = await runSource(kijiji, passthroughSpec('MacBook Air M4'), fanOutOptions({ region: ontario }));
    expect(outcome.status).toMatchObject({ state: 'ok', count: 3 });
  });
});
