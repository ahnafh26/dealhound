import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttpState } from '@/lib/http';
import { resolveRegion } from '@/lib/region';
import { runSource } from '@/lib/search';
import { ebay, parseEbaySearch, resetEbayToken } from '@/lib/sources/ebay';
import { passthroughSpec } from '@/lib/spec';
import { fanOutOptions } from '../helpers';

const fixture = JSON.parse(readFileSync('fixtures/ebay/search.json', 'utf8'));
const region = resolveRegion('CA', 'M5V 3L9');

beforeEach(() => {
  resetHttpState();
  resetEbayToken();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseEbaySearch', () => {
  const listings = parseEbaySearch(fixture, region);

  it('maps item summaries to listings and skips ones without a price', () => {
    expect(listings).toHaveLength(4);
    expect(listings[0]).toMatchObject({
      id: 'ebay:v1|306000000001|0',
      channel: 'protected-marketplace',
      price: 1049,
      currency: 'CAD',
      shipping: 25,
      condition: 'used',
      conditionText: 'Used',
      seller: 'mapleleaf_macs',
      sellerRating: 99.8,
      sellerFeedbackCount: 1240,
      location: 'Mississauga, Ontario',
      imageCount: 3,
    });
  });

  it('maps condition ids, and unknown shipping to null', () => {
    expect(listings.map((l) => l.condition)).toEqual(['used', 'refurb', 'parts', 'new']);
    expect(listings[1].shipping).toBe(0);
    expect(listings[2].shipping).toBeNull(); // CALCULATED, no quote
    expect(listings[3].location).toBe('US');
  });
});

describe('ebay adapter', () => {
  it('is off without keys, on with them, and on in fixture mode', () => {
    vi.stubEnv('EBAY_CLIENT_ID', '');
    vi.stubEnv('EBAY_CLIENT_SECRET', '');
    expect(ebay.enabled()).toBe(false);
    vi.stubEnv('USE_FIXTURES', '1');
    expect(ebay.enabled()).toBe(true);
    vi.stubEnv('USE_FIXTURES', '');
    vi.stubEnv('EBAY_CLIENT_ID', 'id');
    vi.stubEnv('EBAY_CLIENT_SECRET', 'secret');
    expect(ebay.enabled()).toBe(true);
  });

  it('replays its fixture offline, and every listing passes validation', async () => {
    vi.stubEnv('USE_FIXTURES', '1');
    const outcome = await runSource(ebay, passthroughSpec('MacBook Air M4'), fanOutOptions({ region }));
    expect(outcome.status).toMatchObject({ state: 'ok', count: 4 });
  });

  it('gets one token for several searches, and searches Buy It Now with shipping quoted to the postal code', async () => {
    vi.stubEnv('EBAY_CLIENT_ID', 'id');
    vi.stubEnv('EBAY_CLIENT_SECRET', 'secret');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/oauth2/token')
        ? Response.json({ access_token: 'tok-123', expires_in: 7200 })
        : Response.json(fixture),
    );
    vi.stubGlobal('fetch', fetchMock);

    const signal = new AbortController().signal;
    await ebay.search(passthroughSpec('MacBook Air M4'), { region, signal, limit: 50 });
    await ebay.search(passthroughSpec('MacBook Air M4 16GB'), { region, signal, limit: 50 });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes('/oauth2/token'))).toHaveLength(1);

    const [searchUrl, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(new URL(searchUrl).searchParams.get('filter')).toBe('buyingOptions:{FIXED_PRICE},deliveryCountry:CA');
    const headers = new Headers(init.headers);
    expect(headers.get('authorization')).toBe('Bearer tok-123');
    expect(headers.get('x-ebay-c-marketplace-id')).toBe('EBAY_CA');
    expect(decodeURIComponent(headers.get('x-ebay-c-enduserctx') ?? '')).toBe('contextualLocation=country=CA,zip=M5V3L9');
  });

  it('explains rejected keys', async () => {
    vi.stubEnv('EBAY_CLIENT_ID', 'id');
    vi.stubEnv('EBAY_CLIENT_SECRET', 'wrong');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'invalid_client', error_description: 'client authentication failed' }, { status: 401 })),
    );
    await expect(
      ebay.search(passthroughSpec('x'), { region, signal: new AbortController().signal, limit: 5 }),
    ).rejects.toThrow("eBay didn't accept the API keys (HTTP 401): client authentication failed");
  });
});
