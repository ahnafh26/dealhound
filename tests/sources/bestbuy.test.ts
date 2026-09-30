import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttpState } from '@/lib/http';
import { resolveRegion } from '@/lib/region';
import { runSource } from '@/lib/search';
import { bestbuy, parseBestBuyProducts } from '@/lib/sources/bestbuy';
import { planSources } from '@/lib/sources';
import { passthroughSpec } from '@/lib/spec';
import { fanOutOptions } from '../helpers';

const fixture = JSON.parse(readFileSync('fixtures/bestbuy/search.json', 'utf8'));
const us = resolveRegion('US', '10001');

beforeEach(() => resetHttpState());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseBestBuyProducts', () => {
  it('maps products, conditions and shipping', () => {
    const listings = parseBestBuyProducts(fixture, us);
    expect(listings.map((l) => [l.id, l.condition, l.shipping, l.currency])).toEqual([
      ['bestbuy:6600001', 'new', 0, 'USD'],
      ['bestbuy:6600002', 'refurb', 9.99, 'USD'],
      ['bestbuy:6600003', 'new', null, 'USD'],
    ]);
  });
});

describe('bestbuy adapter', () => {
  it('only runs for US searches', () => {
    vi.stubEnv('BESTBUY_API_KEY', 'key');
    const canada = planSources('CA', [bestbuy]).statuses[0];
    expect(canada).toMatchObject({ state: 'skipped', detail: 'Not available in Canada' });
    expect(planSources('US', [bestbuy]).statuses[0].state).toBe('pending');
  });

  it("uses Best Buy's search syntax", async () => {
    vi.stubEnv('BESTBUY_API_KEY', 'key');
    const fetchMock = vi.fn(async () => Response.json(fixture));
    vi.stubGlobal('fetch', fetchMock);

    await bestbuy.search(passthroughSpec('MacBook Air M4'), { region: us, signal: new AbortController().signal, limit: 20 });

    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/v1/products((search=macbook&search=air&search=m4))?');
  });

  it('replays its fixture offline', async () => {
    vi.stubEnv('USE_FIXTURES', '1');
    const outcome = await runSource(bestbuy, passthroughSpec('MacBook Air M4'), fanOutOptions({ region: us }));
    expect(outcome.status).toMatchObject({ state: 'ok', count: 3 });
  });
});
