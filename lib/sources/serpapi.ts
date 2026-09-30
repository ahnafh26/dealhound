import 'server-only';

import { REGIONS } from '@/lib/config';
import { missingEnv, readEnv } from '@/lib/env';
import { politeFetch, useFixtures } from '@/lib/http';
import type { Channel, Condition, Listing, SearchRegion, SourceAdapter } from '@/lib/types';
import { parseMoney } from './parse';

/**
 * Google Shopping through SerpAPI: one call covers most retailers (Best Buy,
 * Amazon, Walmart, Costco, Staples, …). SerpAPI bills per search, so results
 * are cached for an hour.
 */

const REQUIRED = ['SERPAPI_API_KEY'] as const;

export const serpapi: SourceAdapter = {
  id: 'serpapi',
  name: 'Google Shopping',
  type: 'retail',
  requiredEnv: REQUIRED,
  cacheTtlMs: 60 * 60_000,
  enabled: () => useFixtures() || missingEnv(REQUIRED).length === 0,
  async search(spec, { region, signal, limit }) {
    const country = REGIONS[region.code].googleCountry;
    const params = new URLSearchParams({
      engine: 'google_shopping',
      q: spec.searchQuery,
      gl: country,
      hl: 'en',
      google_domain: country === 'ca' ? 'google.ca' : 'google.com',
      api_key: readEnv('SERPAPI_API_KEY') ?? '',
    });
    const response = await politeFetch(`https://serpapi.com/search.json?${params}`, {
      source: 'serpapi',
      fixture: 'search.json',
      signal,
      minIntervalMs: 0,
    });
    const body = JSON.parse(response.text) as { error?: string };
    if (!response.ok || body.error) {
      throw new Error(`SerpAPI: ${body.error?.slice(0, 160) ?? `HTTP ${response.status}`}`);
    }
    return parseShoppingResults(body, region).slice(0, limit);
  },
};

interface ShoppingResult {
  position?: number;
  title?: string;
  product_id?: string;
  link?: string;
  product_link?: string;
  source?: string;
  price?: string;
  extracted_price?: number;
  delivery?: string;
  extensions?: string[];
  second_hand_condition?: string;
  thumbnail?: string;
}

// Marketplaces that sell on Google Shopping too: buyer-protected, but not a retailer's own stock.
const MARKETPLACE_MERCHANTS = /\b(?:ebay|back ?market|reebelo|swappa)\b/i;

export function parseShoppingResults(body: unknown, region: SearchRegion): Listing[] {
  const results = (body as { shopping_results?: ShoppingResult[] } | null)?.shopping_results ?? [];
  const seen = new Set<string>();

  return results.flatMap((result): Listing[] => {
    const price = result.extracted_price ?? parseMoney(result.price);
    const url = result.link ?? result.product_link;
    if (!result.title || !url || price === null || price === undefined) return [];

    const merchant = result.source?.trim() || undefined;
    const id = `serpapi:${result.product_id ?? result.position}:${(merchant ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (seen.has(id)) return [];
    seen.add(id);

    const channel: Channel = merchant && MARKETPLACE_MERCHANTS.test(merchant) ? 'protected-marketplace' : 'retailer';
    return [
      {
        id,
        source: 'serpapi',
        sourceType: 'retail',
        channel,
        url,
        title: result.title,
        price,
        currency: region.currency,
        shipping: shippingFrom([result.delivery, ...(result.extensions ?? [])]),
        condition: conditionFrom(result.second_hand_condition, result.title),
        conditionText: result.second_hand_condition,
        seller: merchant,
        imageUrl: result.thumbnail,
        imageCount: result.thumbnail ? 1 : undefined,
        raw: result,
      },
    ];
  });
}

/** "Free delivery by Oct 3" → 0, "$9.99 delivery" → 9.99; null when nothing says. */
function shippingFrom(notes: (string | undefined)[]): number | null {
  for (const note of notes) {
    if (!note || !/deliver|shipping|pickup/i.test(note)) continue;
    if (/\bfree\b/i.test(note)) return 0;
    const amount = parseMoney(note.match(/\$\s?[\d,]+(?:\.\d{2})?/)?.[0]);
    if (amount !== null) return amount;
  }
  return null;
}

function conditionFrom(secondHand: string | undefined, title: string): Condition {
  const text = `${secondHand ?? ''} ${title}`.toLowerCase();
  if (/for parts|not working/.test(text)) return 'parts';
  if (/refurb|renewed/.test(text)) return 'refurb';
  if (/open[- ]box/.test(text)) return 'open-box';
  if (secondHand || /\b(?:used|pre-owned)\b/.test(text)) return 'used';
  return 'new';
}
