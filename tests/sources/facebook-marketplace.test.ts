import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttpState } from '@/lib/http';
import { resolveRegion } from '@/lib/region';
import { runSource } from '@/lib/search';
import { facebookMarketplace, keepInProvince, parseMarketplaceSearch } from '@/lib/sources/facebook-marketplace';
import { passthroughSpec } from '@/lib/spec';
import type { Listing } from '@/lib/types';
import { fanOutOptions } from '../helpers';

const fixture = readFileSync('fixtures/facebook-marketplace/search.html', 'utf8');
const toronto = resolveRegion('CA', 'M5V 3L9');

beforeEach(() => resetHttpState());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseMarketplaceSearch', () => {
  const listings = parseMarketplaceSearch(fixture, toronto) ?? [];

  it('reads priced, unsold listing records and skips other stories', () => {
    expect(listings.map((l) => l.id)).toEqual([
      'facebook-marketplace:910000000000101',
      'facebook-marketplace:910000000000102',
      'facebook-marketplace:910000000000104',
    ]);
  });

  it('decodes the escaped JSON text and falls back to the formatted price', () => {
    expect(listings[0]).toMatchObject({
      url: 'https://www.facebook.com/marketplace/item/910000000000101/',
      price: 1000,
      location: 'Toronto, ON',
      imageUrl: 'https://scontent-yyz1-1.xx.fbcdn.net/v/t45/demo101.jpg',
      postedAt: new Date(1790500000 * 1000).toISOString(),
      channel: 'local-marketplace',
    });
    expect(listings[1]).toMatchObject({ price: 1100, title: 'MacBook Air 13 M4 16/256 midnight + AppleCare+' });
    expect(listings[2].location).toBe('Montréal, QC');
  });

  it('tells an empty result from a login wall', () => {
    expect(parseMarketplaceSearch('<html>{"__typename":"MarketplaceSearchFeedStories","edges":[]}</html>', toronto)).toEqual([]);
    expect(parseMarketplaceSearch('<html>Log in to Facebook to continue</html>', toronto)).toBeNull();
  });
});

describe('keepInProvince', () => {
  const listings = parseMarketplaceSearch(fixture, toronto) ?? [];

  it('drops padding from other provinces', () => {
    expect(keepInProvince(listings, 'ON', 'toronto').map((l) => l.location)).toEqual(['Toronto, ON', 'Mississauga, ON']);
  });

  it('refuses a page that is entirely from elsewhere, since the city token must be wrong', () => {
    const elsewhere = Array.from({ length: 5 }, (_, i): Listing => ({ ...listings[2], id: `x:${i}` }));
    expect(() => keepInProvince(elsewhere, 'ON', 'kingston')).toThrow(/check FACEBOOK_CITY/);
  });
});

describe('facebookMarketplace adapter', () => {
  it('is off unless enabled', () => {
    expect(facebookMarketplace.enabled()).toBe(false);
    vi.stubEnv('FACEBOOK_ENABLED', '1');
    expect(facebookMarketplace.enabled()).toBe(true);
  });

  it("searches the province's verified city", async () => {
    vi.stubEnv('FACEBOOK_ENABLED', '1');
    const fetchMock = vi.fn(async () => new Response(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const listings = await facebookMarketplace.search(passthroughSpec('MacBook Air M4'), {
      region: toronto,
      signal: new AbortController().signal,
      limit: 50,
    });

    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      'https://www.facebook.com/marketplace/toronto/search?query=MacBook+Air+M4',
    );
    expect(listings).toHaveLength(2);
  });

  it('needs FACEBOOK_CITY outside Ontario and Québec, rather than guessing', async () => {
    vi.stubEnv('FACEBOOK_ENABLED', '1');
    const outcome = await runSource(
      facebookMarketplace,
      passthroughSpec('MacBook Air M4'),
      fanOutOptions({ region: resolveRegion('CA', 'V6B 1A1') }),
    );
    expect(outcome.status.detail).toMatch(/FACEBOOK_CITY/);
  });

  it('backs off after a login wall', async () => {
    vi.stubEnv('FACEBOOK_ENABLED', '1');
    const fetchMock = vi.fn(async () => new Response('<html>Log in to Facebook</html>'));
    vi.stubGlobal('fetch', fetchMock);
    const opts = fanOutOptions({ region: toronto });

    await runSource(facebookMarketplace, passthroughSpec('MacBook Air M4'), opts);
    const second = await runSource(facebookMarketplace, passthroughSpec('Sony XM5'), opts);

    expect(second.status.detail).toMatch(/resting/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('replays its fixture offline', async () => {
    vi.stubEnv('USE_FIXTURES', '1');
    const outcome = await runSource(facebookMarketplace, passthroughSpec('MacBook Air M4'), fanOutOptions({ region: toronto }));
    expect(outcome.status).toMatchObject({ state: 'ok', count: 2 });
  });
});
