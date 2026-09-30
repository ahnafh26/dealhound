import 'server-only';

import { POLITENESS } from '@/lib/config';
import { isEnabled, readEnv } from '@/lib/env';
import { politeFetch, useFixtures } from '@/lib/http';
import type { Listing, SearchRegion, SourceAdapter } from '@/lib/types';

/**
 * Craigslist, read the way carbuyer reads it: the public JSON feed that
 * Craigslist's own search page loads from sapi.craigslist.org, requested
 * the way a browser would. Opt in with CRAIGSLIST_ENABLED=1. Sales are local
 * pickup, so shipping is 0.
 *
 * Craigslist's terms prohibit automated access; see the README.
 */

interface Area {
  host: string;
  id: number;
  label: string;
}

// Area ids carbuyer confirmed against reference.craigslist.org/Areas (2026-09-29). A wrong id
// fails silently, answering with San Francisco listings, so unknown areas are never guessed.
const AREAS: Record<string, Area> = {
  toronto: { host: 'toronto', id: 25, label: 'Toronto' },
  ottawa: { host: 'ottawa', id: 76, label: 'Ottawa' },
  hamilton: { host: 'hamilton', id: 213, label: 'Hamilton' },
  kitchener: { host: 'kitchener', id: 214, label: 'Kitchener' },
  london: { host: 'londonon', id: 234, label: 'London' },
  windsor: { host: 'windsor', id: 235, label: 'Windsor' },
  niagara: { host: 'niagara', id: 386, label: 'Niagara' },
  guelph: { host: 'guelph', id: 482, label: 'Guelph' },
  barrie: { host: 'barrie', id: 389, label: 'Barrie' },
  kingston: { host: 'kingston', id: 385, label: 'Kingston' },
  peterborough: { host: 'peterborough', id: 388, label: 'Peterborough' },
  sudbury: { host: 'sudbury', id: 384, label: 'Sudbury' },
  montreal: { host: 'montreal', id: 49, label: 'Montréal' },
  quebec: { host: 'quebec', id: 175, label: 'Québec' },
  sherbrooke: { host: 'sherbrooke', id: 390, label: 'Sherbrooke' },
};

const DEFAULT_AREA: Record<string, string> = { ON: 'toronto', QC: 'montreal' };

/** Two areas at most: one feed call each, spaced out, has to fit inside the search deadline. */
const MAX_AREAS = 2;

export const craigslist: SourceAdapter = {
  id: 'craigslist',
  name: 'Craigslist',
  type: 'marketplace',
  regions: ['CA'],
  cacheTtlMs: POLITENESS.scrapeCacheTtlMs,
  enabled: () => useFixtures() || isEnabled('CRAIGSLIST_ENABLED'),
  disabledReason: () => 'Off: set CRAIGSLIST_ENABLED=1 to read its public search feed',
  async search(spec, { region, signal, limit }) {
    const areas = areasFor(region);
    const listings: Listing[] = [];
    for (const area of areas) {
      const params = new URLSearchParams({
        batch: `${area.id}-0-360-0-0`,
        cc: 'CA',
        lang: 'en',
        query: spec.searchQuery,
        searchPath: 'sss', // all for-sale categories
      });
      const response = await politeFetch(`https://sapi.craigslist.org/web/v8/postings/search/full?${params}`, {
        source: 'craigslist',
        fixture: 'search.json',
        signal,
        identity: 'browser',
        // What the search page's own request sends.
        headers: {
          accept: 'application/json, text/plain, */*',
          referer: `https://${area.host}.craigslist.org/`,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
        },
      });
      if (!response.ok) throw new Error(`Craigslist returned HTTP ${response.status}`);
      listings.push(...parseCraigslistFeed(JSON.parse(response.text), area, region));
      if (useFixtures()) break;
    }
    return listings.slice(0, limit);
  },
};

/**
 * CRAIGSLIST_SITES picks the areas: known names ("toronto,hamilton"), or
 * "host:id" for any other site (look the id up at reference.craigslist.org/Areas).
 * Otherwise the shopper's province picks one.
 */
export function areasFor(region: SearchRegion): Area[] {
  const configured = readEnv('CRAIGSLIST_SITES');
  const names = configured ? configured.split(',') : [DEFAULT_AREA[region.subdivision] ?? ''];
  const areas = names.flatMap((raw): Area[] => {
    const name = raw.trim().toLowerCase();
    const custom = /^([a-z]+):(\d+)$/.exec(name);
    if (custom) return [{ host: custom[1], id: Number(custom[2]), label: custom[1] }];
    return AREAS[name] ? [AREAS[name]] : [];
  });
  if (areas.length === 0) {
    throw new Error(
      `No Craigslist area for ${region.subdivision}: set CRAIGSLIST_SITES, e.g. vancouver:<id from reference.craigslist.org/Areas>`,
    );
  }
  return areas.slice(0, MAX_AREAS);
}

// ─── Feed decoding ───────────────────────────────────────────────────────

interface Decode {
  minPostingId?: number;
  minPostedDate?: number;
  locationDescriptions?: unknown[];
}

/**
 * The feed is compact rather than self-describing. Each item is
 *   [postingIdOffset, postedDateOffset, categoryId, price, "loc:desc~lat~lon", thumb, ...tagged, title]
 * where the id and date are offsets from decode.minPostingId / minPostedDate,
 * tagged slots are [tag, ...values] (4 images, 6 URL slug, 13 URL token), and
 * the title is the one bare string.
 */
export function parseCraigslistFeed(body: unknown, area: Area, region: SearchRegion): Listing[] {
  const data = (body as { data?: { items?: unknown; decode?: Decode } } | null)?.data;
  if (!data || !Array.isArray(data.items) || !data.decode) {
    throw new Error('The Craigslist feed has no items; its format may have changed');
  }
  const decode = data.decode;

  return data.items.flatMap((item): Listing[] => {
    if (!Array.isArray(item) || item.length < 6) return [];
    const [idOffset, dateOffset, , price, place] = item as unknown[];

    let title: string | undefined;
    const tagged = new Map<number, unknown[]>();
    for (const slot of item.slice(6)) {
      if (Array.isArray(slot) && typeof slot[0] === 'number') tagged.set(slot[0], slot.slice(1));
      else if (typeof slot === 'string') title = slot;
    }

    const postingId = Number(decode.minPostingId) + Number(idOffset);
    const slug = tagged.get(6)?.[0];
    const token = tagged.get(13)?.[0];
    if (!title || !Number.isFinite(postingId) || typeof price !== 'number' || price <= 0 || !slug || !token) return [];

    const postedSeconds = Number(decode.minPostedDate) + Number(dateOffset);
    const images = (tagged.get(4) ?? [])
      .map((image) => String(image).replace(/^\d+:/, ''))
      .filter(Boolean)
      .map((image) => `https://images.craigslist.org/${image}_600x450.jpg`);

    return [
      {
        id: `craigslist:${postingId}`,
        source: 'craigslist',
        sourceType: 'marketplace',
        channel: 'local-marketplace',
        url: `https://www.craigslist.org/view/d/${slug}/${token}`,
        title,
        price,
        currency: region.currency,
        shipping: 0,
        // The feed doesn't carry the condition; the matcher reads it from the title.
        condition: 'unknown',
        location: placeName(place, decode) ?? area.label,
        imageUrl: images[0],
        imageCount: images.length,
        postedAt: Number.isFinite(postedSeconds) ? new Date(postedSeconds * 1000).toISOString() : undefined,
        raw: item,
      },
    ];
  });
}

/** The seller-written location line, when it reads like a place rather than a phone number. */
function placeName(place: unknown, decode: Decode): string | undefined {
  const [where] = String(place ?? '').split('~');
  const descriptionIndex = Number(where.split(':')[1]);
  const text = descriptionIndex > 0 ? decode.locationDescriptions?.[descriptionIndex] : undefined;
  return typeof text === 'string' && /^[\p{L} .,'()/-]{2,40}$/u.test(text.trim()) ? text.trim() : undefined;
}
