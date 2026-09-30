import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttpState } from '@/lib/http';
import { resolveRegion } from '@/lib/region';
import { runSource } from '@/lib/search';
import { parseShoppingResults, serpapi } from '@/lib/sources/serpapi';
import { passthroughSpec } from '@/lib/spec';
import { fanOutOptions } from '../helpers';

const fixture = JSON.parse(readFileSync('fixtures/serpapi/search.json', 'utf8'));
const region = resolveRegion('CA', 'M5V 3L9');

beforeEach(() => resetHttpState());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseShoppingResults', () => {
  const listings = parseShoppingResults(fixture, region);

  it('keeps one listing per merchant offer, skipping ones without a price', () => {
    expect(listings.map((l) => l.seller)).toEqual([
      'Best Buy',
      'Costco',
      'Amazon.ca - Seller',
      'eBay - mapleleaf_macs',
      'Visions Electronics',
    ]);
    expect(new Set(listings.map((l) => l.id)).size).toBe(listings.length);
  });

  it('reads shipping from the delivery note or the extensions', () => {
    expect(listings.map((l) => l.shipping)).toEqual([0, 0, 14.99, null, null]);
  });

  it('reads the condition, and treats eBay sellers as a marketplace', () => {
    expect(listings.map((l) => l.condition)).toEqual(['new', 'new', 'refurb', 'used', 'open-box']);
    expect(listings[3].channel).toBe('protected-marketplace');
    expect(listings[0].channel).toBe('retailer');
  });

  it("prefers the merchant's own link over Google's product page", () => {
    expect(listings[0].url).toContain('bestbuy.ca');
    expect(listings[2].url).toContain('google.ca/shopping');
  });
});

describe('serpapi adapter', () => {
  it('replays its fixture offline, with every listing valid', async () => {
    vi.stubEnv('USE_FIXTURES', '1');
    const outcome = await runSource(serpapi, passthroughSpec('MacBook Air M4'), fanOutOptions({ region }));
    expect(outcome.status).toMatchObject({ state: 'ok', count: 5 });
  });

  it('asks Google Canada, and reports SerpAPI errors without the key', async () => {
    vi.stubEnv('SERPAPI_API_KEY', 'serp-secret');
    const fetchMock = vi.fn(async () => Response.json({ error: 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await runSource(serpapi, passthroughSpec('MacBook Air M4'), fanOutOptions({ region }));

    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('gl')).toBe('ca');
    expect(url.searchParams.get('google_domain')).toBe('google.ca');
    expect(outcome.status.state).toBe('error');
    expect(outcome.status.detail).toContain('Invalid API key');
    expect(outcome.status.detail).not.toContain('serp-secret');
  });
});
