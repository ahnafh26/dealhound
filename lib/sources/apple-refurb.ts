import 'server-only';

import { POLITENESS } from '@/lib/config';
import { isEnabled } from '@/lib/env';
import { politeFetch, fixtureMode } from '@/lib/http';
import type { Listing, ProductSpec, SearchRegion, SourceAdapter } from '@/lib/types';
import { parseMoney, relevance, sliceJsonObject } from './parse';

/**
 * Apple Certified Refurbished: the public refurbished-store page for the
 * product's category, read with DealHound's own User-Agent and only where
 * Apple's robots.txt allows. Everything there carries Apple's one-year
 * warranty and can get AppleCare+. The page lists the whole category, so a
 * listing must contain every word of the search. Opt in with
 * APPLE_REFURB_ENABLED=1.
 */

const CATEGORIES: [RegExp, string][] = [
  [/\b(?:mac\s?book|imac|mac\s?mini|mac\s?studio|mac\s?pro|laptop|desktop)\b/i, 'mac'],
  [/\b(?:ipad|tablet)\b/i, 'ipad'],
  [/\b(?:iphone|phone)\b/i, 'iphone'],
  [/\bwatch\b/i, 'watch'],
  [/\bapple\s?tv\b/i, 'appletv'],
];

const APPLE_PRODUCTS = /\b(?:apple|mac\s?book|imac|mac\s?mini|mac\s?studio|ipad|iphone|apple\s?watch|apple\s?tv)\b/i;

export const appleRefurb: SourceAdapter = {
  id: 'apple-refurb',
  name: 'Apple Certified Refurbished',
  type: 'refurb',
  regions: ['CA', 'US'],
  cacheTtlMs: POLITENESS.scrapeCacheTtlMs,
  enabled: () => fixtureMode() || isEnabled('APPLE_REFURB_ENABLED'),
  disabledReason: () => 'Off: set APPLE_REFURB_ENABLED=1 to read the refurbished store',
  async search(spec, { region, signal, limit }) {
    const category = appleCategory(spec);
    if (!category) return []; // Not something Apple refurbishes.

    const url = `https://www.apple.com${region.code === 'CA' ? '/ca' : ''}/shop/refurbished/${category}`;
    const response = await politeFetch(url, {
      source: 'apple-refurb',
      fixture: `${category}.html`,
      signal,
      robots: true,
    });
    if (!response.ok) throw new Error(`Apple returned HTTP ${response.status}`);

    const tiles = parseRefurbGrid(response.text);
    if (!tiles) throw new Error("Apple's refurbished page changed shape: no product grid found");
    return tiles
      .flatMap((tile) => toListing(tile, region))
      .filter((listing) => relevance(spec.searchQuery, listing.title) === 1)
      .slice(0, limit);
  },
};

/** Which refurbished-store page to read, or null for products Apple doesn't make. */
export function appleCategory(spec: ProductSpec): string | null {
  if (spec.brand && spec.brand !== 'Apple') return null;
  const text = [spec.category, spec.model, spec.searchQuery].filter(Boolean).join(' ');
  if (!spec.brand && !APPLE_PRODUCTS.test(text)) return null;
  return CATEGORIES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

interface RefurbTile {
  title?: string;
  productDetailsUrl?: string;
  partNumber?: string;
  price?: { currentPrice?: { amount?: string; raw_amount?: string } };
  image?: { srcSet?: { src?: string } };
}

/** The product grid Apple embeds as `window.REFURB_GRID_BOOTSTRAP = {...}`, or null if it's gone. */
export function parseRefurbGrid(html: string): RefurbTile[] | null {
  const marker = html.indexOf('REFURB_GRID_BOOTSTRAP');
  const json = marker === -1 ? null : sliceJsonObject(html, html.indexOf('{', marker));
  if (!json) return null;
  try {
    const tiles = (JSON.parse(json) as { tiles?: unknown }).tiles;
    return Array.isArray(tiles) ? (tiles as RefurbTile[]) : null;
  } catch {
    return null;
  }
}

function toListing(tile: RefurbTile, region: SearchRegion): Listing[] {
  const current = tile.price?.currentPrice;
  const price = current?.raw_amount ? Number(current.raw_amount) : parseMoney(current?.amount);
  if (!tile.title || !tile.productDetailsUrl || price === null || !Number.isFinite(price)) return [];

  const url = new URL(tile.productDetailsUrl, 'https://www.apple.com').toString();
  return [
    {
      id: `apple-refurb:${tile.partNumber ?? url}`,
      source: 'apple-refurb',
      sourceType: 'refurb',
      channel: 'certified-refurb',
      url,
      title: tile.title,
      price,
      currency: region.currency,
      shipping: 0, // Apple ships free.
      condition: 'refurb',
      conditionText: 'Apple Certified Refurbished',
      seller: 'Apple',
      warrantyMonths: 12,
      imageUrl: tile.image?.srcSet?.src,
      imageCount: tile.image?.srcSet?.src ? 1 : undefined,
      raw: tile,
    },
  ];
}
