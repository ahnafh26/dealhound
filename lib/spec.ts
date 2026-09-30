import type { ProductSpec, SpecResult } from './types';

/**
 * Turns the shopper's query into a ProductSpec. Currently a passthrough: the
 * whole query becomes the search string and no attribute is required, so
 * every listing a source returns is shown.
 */
export async function parseQuery(query: string): Promise<SpecResult> {
  return { kind: 'spec', spec: passthroughSpec(query) };
}

export function passthroughSpec(query: string): ProductSpec {
  const clean = query.replace(/\s+/g, ' ').trim();
  return {
    query: clean,
    searchQuery: clean,
    category: null,
    brand: null,
    model: null,
    variant: null,
    required: {},
    optional: {},
    parsedBy: 'passthrough',
  };
}
