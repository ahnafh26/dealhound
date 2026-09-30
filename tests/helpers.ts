import { MemoryCache } from '@/lib/cache';
import { resolveRegion } from '@/lib/region';
import type { FanOutOptions } from '@/lib/search';
import type { Listing, SourceAdapter } from '@/lib/types';

export function makeListing(id: string, overrides: Partial<Listing> = {}): Listing {
  return {
    id,
    source: id.split(':')[0],
    sourceType: 'retail',
    channel: 'retailer',
    url: `https://example.com/${encodeURIComponent(id)}`,
    title: 'Apple MacBook Air 13-inch M4 16GB 256GB',
    price: 1399,
    currency: 'CAD',
    shipping: 0,
    condition: 'new',
    raw: null,
    ...overrides,
  };
}

export function makeAdapter(id: string, search: SourceAdapter['search']): SourceAdapter {
  return { id, name: id, type: 'retail', enabled: () => true, search };
}

export function fanOutOptions(overrides: Partial<FanOutOptions> = {}): FanOutOptions {
  return {
    region: resolveRegion('CA', 'M5V 3L9'),
    signal: new AbortController().signal,
    limit: 50,
    timeoutMs: 200,
    cache: new MemoryCache(),
    ...overrides,
  };
}
