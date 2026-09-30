import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttpState } from '@/lib/http';
import { resolveRegion } from '@/lib/region';
import { runSource } from '@/lib/search';
import { areasFor, craigslist, parseCraigslistFeed } from '@/lib/sources/craigslist';
import { passthroughSpec } from '@/lib/spec';
import { fanOutOptions } from '../helpers';

const fixture = JSON.parse(readFileSync('fixtures/craigslist/search.json', 'utf8'));
const toronto = resolveRegion('CA', 'M5V 3L9');
const area = { host: 'toronto', id: 25, label: 'Toronto' };

beforeEach(() => resetHttpState());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('parseCraigslistFeed', () => {
  const listings = parseCraigslistFeed(fixture, area, toronto);

  it('decodes ids and dates from offsets, and builds the post URL', () => {
    expect(listings[0]).toMatchObject({
      id: 'craigslist:7880000101',
      url: 'https://www.craigslist.org/view/d/toronto-m4-macbook-air-16gb-256gb-barely/7880000101',
      title: 'M4 MacBook Air 16GB 256GB - barely used',
      price: 1000,
      shipping: 0,
      channel: 'local-marketplace',
      postedAt: new Date((1790000000 + 3600) * 1000).toISOString(),
      imageUrl: 'https://images.craigslist.org/00a0a_demo1_600x450.jpg',
      imageCount: 2,
    });
  });

  it('skips items without a price or a URL', () => {
    expect(listings.map((l) => l.id)).toEqual(['craigslist:7880000101', 'craigslist:7880000102', 'craigslist:7880000103']);
  });

  it('uses the location line only when it reads like a place', () => {
    expect(listings.map((l) => l.location)).toEqual(['Leslieville', 'Scarborough', 'Toronto']);
  });

  it('refuses a feed that changed shape', () => {
    expect(() => parseCraigslistFeed({ data: {} }, area, toronto)).toThrow(/format may have changed/);
  });
});

describe('areasFor', () => {
  it("picks the province's main site, or the configured ones", () => {
    expect(areasFor(toronto).map((a) => a.id)).toEqual([25]);
    vi.stubEnv('CRAIGSLIST_SITES', 'hamilton, vancouver:16, nowhere');
    expect(areasFor(toronto).map((a) => a.id)).toEqual([213, 16]);
  });

  it('never guesses an area it does not know', () => {
    expect(() => areasFor(resolveRegion('CA', 'V6B 1A1'))).toThrow(/CRAIGSLIST_SITES/);
  });
});

describe('craigslist adapter', () => {
  it('is off unless enabled', () => {
    expect(craigslist.enabled()).toBe(false);
    vi.stubEnv('CRAIGSLIST_ENABLED', '1');
    expect(craigslist.enabled()).toBe(true);
  });

  it('asks the feed the way the search page does', async () => {
    vi.stubEnv('CRAIGSLIST_ENABLED', '1');
    const fetchMock = vi.fn(async () => Response.json(fixture));
    vi.stubGlobal('fetch', fetchMock);

    await craigslist.search(passthroughSpec('MacBook Air M4'), {
      region: toronto,
      signal: new AbortController().signal,
      limit: 50,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const params = new URL(url).searchParams;
    expect(params.get('batch')).toBe('25-0-360-0-0');
    expect(params.get('query')).toBe('MacBook Air M4');
    expect(new Headers(init.headers).get('referer')).toBe('https://toronto.craigslist.org/');
  });

  it('replays its fixture offline', async () => {
    vi.stubEnv('USE_FIXTURES', '1');
    const outcome = await runSource(craigslist, passthroughSpec('MacBook Air M4'), fanOutOptions({ region: toronto }));
    expect(outcome.status).toMatchObject({ state: 'ok', count: 3 });
  });
});
