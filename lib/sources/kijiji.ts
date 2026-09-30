import 'server-only';

import { POLITENESS } from '@/lib/config';
import { isEnabled, readEnv } from '@/lib/env';
import { politeFetch, reportBlocked, useFixtures } from '@/lib/http';
import type { Condition, Listing, SearchRegion, SourceAdapter } from '@/lib/types';
import { stripHtml, truncate } from './parse';

/**
 * Kijiji, read the way carbuyer reads it: an ordinary search results page
 * (no login, no browser), whose listings Kijiji embeds as JSON in the
 * __NEXT_DATA__ script tag. Opt in with KIJIJI_ENABLED=1. Sales are local
 * pickup, so shipping is 0.
 *
 * Kijiji's terms prohibit automated access; see the README.
 */

const ORIGIN = 'https://www.kijiji.ca';

// Province → Kijiji location. Ontario and Québec are confirmed by carbuyer; the others follow
// Kijiji's numbering but haven't been checked. KIJIJI_LOCATION overrides, as "<slug>/<id>".
const LOCATIONS: Record<string, { slug: string; id: number }> = {
  ON: { slug: 'ontario', id: 9004 },
  QC: { slug: 'quebec', id: 9001 },
  BC: { slug: 'british-columbia', id: 9007 },
  AB: { slug: 'alberta', id: 9003 },
  MB: { slug: 'manitoba', id: 9006 },
  SK: { slug: 'saskatchewan', id: 9009 },
  NS: { slug: 'nova-scotia', id: 9002 },
  NB: { slug: 'new-brunswick', id: 9005 },
  NL: { slug: 'newfoundland', id: 9008 },
  PE: { slug: 'prince-edward-island', id: 9011 },
  NT: { slug: 'territories', id: 9010 },
  NU: { slug: 'territories', id: 9010 },
  YT: { slug: 'territories', id: 9010 },
};

export const kijiji: SourceAdapter = {
  id: 'kijiji',
  name: 'Kijiji',
  type: 'marketplace',
  regions: ['CA'],
  cacheTtlMs: POLITENESS.scrapeCacheTtlMs,
  enabled: () => useFixtures() || isEnabled('KIJIJI_ENABLED'),
  disabledReason: () => 'Off: set KIJIJI_ENABLED=1 to read its search pages',
  async search(spec, { region, signal, limit }) {
    const response = await politeFetch(kijijiSearchUrl(spec.searchQuery, region), {
      source: 'kijiji',
      fixture: 'search.html',
      signal,
      identity: 'browser',
    });
    if (!response.ok) throw new Error(`Kijiji returned HTTP ${response.status}`);
    const page = parseKijijiPage(response.text, region);
    // No page data means a block page (or a redesign): back off either way.
    if (!page) throw reportBlocked('kijiji', 'Kijiji served a page without listing data');
    return page.slice(0, limit);
  },
};

/** "MacBook Air M4" in Ontario → /b-buy-sell/ontario/macbook-air-m4/k0c10l9004 (c10 = Buy & Sell). */
export function kijijiSearchUrl(query: string, region: SearchRegion): string {
  const override = /^([a-z-]+)\/(\d+)$/.exec(readEnv('KIJIJI_LOCATION') ?? '');
  const location = override ? { slug: override[1], id: Number(override[2]) } : (LOCATIONS[region.subdivision] ?? { slug: 'canada', id: 0 });
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
  return `${ORIGIN}/b-buy-sell/${location.slug}/${words}/k0c10l${location.id}`;
}

// ─── Page parsing ────────────────────────────────────────────────────────

interface KijijiListing {
  id?: string | number;
  title?: string;
  description?: string;
  url?: string;
  price?: { type?: string; amount?: number };
  imageUrls?: string[];
  imageCount?: number;
  location?: { address?: string; name?: string };
  activationDate?: string;
  sortingDate?: string;
  adSource?: string;
  attributes?: { all?: { canonicalName?: string; canonicalValues?: unknown[] }[] };
}

const NEXT_DATA = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

/** Organic listings with a fixed price, or null when the page carries no listing data at all. */
export function parseKijijiPage(html: string, region: SearchRegion): Listing[] | null {
  const script = NEXT_DATA.exec(html)?.[1];
  if (!script) return null;
  let apollo: Record<string, unknown> | undefined;
  try {
    apollo = JSON.parse(script)?.props?.pageProps?.__APOLLO_STATE__;
  } catch {
    return null;
  }
  if (!apollo || typeof apollo !== 'object') return null;

  // Listings are normalized into an Apollo cache: "AutosListing:123", "StandardListing:456", ...
  return Object.entries(apollo).flatMap(([key, value]): Listing[] => {
    if (!/^[A-Za-z]*Listing:/.test(key)) return [];
    const raw = value as KijijiListing;
    // TOP_AD and PROV_TOP_AD are paid placements, not search matches.
    if (raw.adSource && raw.adSource !== 'ORGANIC') return [];
    // "Please contact", "Swap/Trade" and "Free" carry no price to compare.
    if ((raw.price?.type && raw.price.type !== 'FIXED') || typeof raw.price?.amount !== 'number') return [];
    if (raw.id === undefined || !raw.title || !raw.url) return [];

    const description = raw.description ? truncate(stripHtml(raw.description)) : undefined;
    return [
      {
        id: `kijiji:${raw.id}`,
        source: 'kijiji',
        sourceType: 'marketplace',
        channel: 'local-marketplace',
        url: new URL(raw.url, ORIGIN).toString(),
        title: raw.title,
        // Kijiji stores prices in cents.
        price: raw.price.amount / 100,
        currency: region.currency,
        shipping: 0,
        condition: conditionOf(raw),
        conditionText: attribute(raw, 'condition'),
        location: placeOf(raw.location),
        imageUrl: raw.imageUrls?.[0],
        imageCount: raw.imageCount ?? raw.imageUrls?.length,
        description,
        postedAt: raw.activationDate ?? raw.sortingDate,
        raw,
      },
    ];
  });
}

function attribute(raw: KijijiListing, name: string): string | undefined {
  const found = raw.attributes?.all?.find((entry) => entry.canonicalName === name)?.canonicalValues?.[0];
  return typeof found === 'string' ? found : undefined;
}

function conditionOf(raw: KijijiListing): Condition {
  const value = attribute(raw, 'condition')?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  if (!value) return 'unknown';
  if (value.includes('parts')) return 'parts';
  if (value.includes('refurb')) return 'refurb';
  if (value.includes('likenew') || value.includes('excellent')) return 'used-excellent';
  if (value.includes('good')) return 'used-good';
  if (value.includes('fair')) return 'used-fair';
  if (value.includes('used')) return 'used';
  if (value.includes('new')) return 'new';
  return 'unknown';
}

/** "Pointe-Claire, QC H9R 1A1" → "Pointe-Claire, QC": the postal code adds nothing for the shopper. */
function placeOf(location: KijijiListing['location']): string | undefined {
  const text = location?.address ?? location?.name;
  return text?.replace(/\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i, '').trim() || undefined;
}
