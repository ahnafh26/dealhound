import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttpState } from '@/lib/http';
import { resolveRegion } from '@/lib/region';
import { runSource } from '@/lib/search';
import { appleCategory, appleRefurb, parseRefurbGrid } from '@/lib/sources/apple-refurb';
import { passthroughSpec } from '@/lib/spec';
import { parseWithRules } from '@/lib/spec-rules';
import { fanOutOptions } from '../helpers';

const fixture = readFileSync('fixtures/apple-refurb/mac.html', 'utf8');
const canada = resolveRegion('CA', 'M5V 3L9');

beforeEach(() => resetHttpState());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseRefurbGrid', () => {
  it('finds the embedded product grid', () => {
    const tiles = parseRefurbGrid(fixture) ?? [];
    expect(tiles).toHaveLength(4);
    expect(tiles[0].partNumber).toBe('FW0X3LL/A');
  });

  it('returns null when the grid is gone', () => {
    expect(parseRefurbGrid('<html>Refurbished Mac</html>')).toBeNull();
  });
});

describe('appleCategory', () => {
  it('maps Apple products to their refurbished-store page', () => {
    expect(appleCategory(parseWithRules('M4 MacBook Air 16GB').spec)).toBe('mac');
    expect(appleCategory(parseWithRules('iphone 15 pro 256gb').spec)).toBe('iphone');
    expect(appleCategory(passthroughSpec('ipad air m2'))).toBe('ipad');
  });

  it('skips everything else, including laptops from other brands', () => {
    expect(appleCategory(parseWithRules('Sony WH-1000XM5').spec)).toBeNull();
    expect(appleCategory(parseWithRules('Dell XPS 13 laptop').spec)).toBeNull();
    expect(appleCategory(passthroughSpec('gaming laptop'))).toBeNull();
  });
});

describe('appleRefurb adapter', () => {
  it('keeps only products matching every word of the search, with the Apple warranty', async () => {
    vi.stubEnv('USE_FIXTURES', '1');
    const outcome = await runSource(appleRefurb, parseWithRules('M4 MacBook Air 16GB').spec, fanOutOptions({ region: canada }));

    expect(outcome.status).toMatchObject({ state: 'ok', count: 2 });
    expect(outcome.listings[0]).toMatchObject({
      url: 'https://www.apple.com/ca/shop/product/FW0X3LL/A/refurbished-13-inch-macbook-air-apple-m4-chip-with-10-core-cpu-and-8-core-gpu-midnight',
      price: 1189,
      channel: 'certified-refurb',
      condition: 'refurb',
      warrantyMonths: 12,
      shipping: 0,
    });
  });

  it("stays out when Apple's robots.txt says so, identifying as DealHound", async () => {
    vi.stubEnv('APPLE_REFURB_ENABLED', '1');
    vi.stubEnv('DEALHOUND_USER_AGENT', 'DealHound/test');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/robots.txt')
        ? new Response('User-agent: *\nDisallow: /ca/shop/refurbished\n')
        : new Response(fixture),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await runSource(appleRefurb, parseWithRules('MacBook Air M4').spec, fanOutOptions({ region: canada }));

    expect(outcome.status).toMatchObject({ state: 'error' });
    expect(outcome.status.detail).toMatch(/robots\.txt/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get('user-agent')).toBe(
      'DealHound/test',
    );
  });

  it('does not fetch anything for non-Apple products', async () => {
    vi.stubEnv('APPLE_REFURB_ENABLED', '1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await runSource(appleRefurb, parseWithRules('Sony WH-1000XM5').spec, fanOutOptions({ region: canada }));
    expect(outcome.status).toMatchObject({ state: 'ok', count: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
