import 'server-only';

import { POLITENESS } from '@/lib/config';
import { isEnabled, readEnv } from '@/lib/env';
import { politeFetch, reportBlocked, fixtureMode } from '@/lib/http';
import type { Listing, SearchRegion, SourceAdapter } from '@/lib/types';
import { parseMoney, unescapeJsonString } from './parse';

/**
 * Facebook Marketplace, read the way carbuyer reads it: the search page a
 * logged-out browser gets, which embeds a slice of real listing data (title,
 * price, city, photo, post time) in its JSON. No account, no cookies. About
 * 24 listings come back per request and the page is heavy, so it's one
 * request per search, cached 30 minutes, and a login wall rests it for 30
 * minutes. Opt in with FACEBOOK_ENABLED=1. Sales are local pickup.
 *
 * Meta's terms prohibit automated collection; see the README.
 */

const ORIGIN = 'https://www.facebook.com';

// City tokens carbuyer verified serve their own city. A wrong token fails silently (it answers
// with another region's listings), so elsewhere FACEBOOK_CITY must name a verified word or a
// numeric city page id.
const CITY_BY_PROVINCE: Record<string, string> = { ON: 'toronto', QC: 'montreal' };

export const facebookMarketplace: SourceAdapter = {
  id: 'facebook-marketplace',
  name: 'Facebook Marketplace',
  type: 'marketplace',
  regions: ['CA'],
  cacheTtlMs: POLITENESS.scrapeCacheTtlMs,
  enabled: () => fixtureMode() || isEnabled('FACEBOOK_ENABLED'),
  disabledReason: () => 'Off: set FACEBOOK_ENABLED=1 to read its logged-out search page',
  async search(spec, { region, signal, limit }) {
    const override = readEnv('FACEBOOK_CITY');
    const city = override ?? CITY_BY_PROVINCE[region.subdivision];
    if (!city) {
      throw new Error(`No Marketplace city for ${region.subdivision}: set FACEBOOK_CITY (see the README)`);
    }
    const url = `${ORIGIN}/marketplace/${encodeURIComponent(city)}/search?${new URLSearchParams({ query: spec.searchQuery })}`;
    const response = await politeFetch(url, {
      source: 'facebook-marketplace',
      fixture: 'search.html',
      signal,
      identity: 'browser',
    });
    if (!response.ok) throw new Error(`Facebook returned HTTP ${response.status}`);

    const listings = parseMarketplaceSearch(response.text, region);
    if (!listings) throw reportBlocked('facebook-marketplace', 'Facebook showed a login wall instead of Marketplace');
    // Only a city we picked from the province can be checked against it.
    return (override ? listings : keepInProvince(listings, region.subdivision, city)).slice(0, limit);
  },
};

// ─── Page parsing ────────────────────────────────────────────────────────

// Marks the start of one listing record. A record holds several "id" fields (the listing, its
// photo, its city page), so anchoring on the record and reading forward takes the right one.
const RECORD = /"listing":\{(?:"__typename":"[^"]*",)?"id":"(\d+)"/g;
const TITLE = /"marketplace_listing_title":"((?:[^"\\]|\\.)*)"/;
const AMOUNT = /"listing_price":\{[^{}]*?"amount":"(\d+(?:\.\d+)?)"/;
const FORMATTED = /"listing_price":\{"formatted_amount":"((?:[^"\\]|\\.)*)"/;
const CITY = /"reverse_geocode":\{"city":"((?:[^"\\]|\\.)*)"/;
const STATE = /"state":"([A-Z]{2})"/;
const CREATED = /"creation_time":(\d+)/;
const PHOTO = /"uri":"(https:\\?\/\\?\/scontent[^"]*)"/;
const SOLD = /"is_sold":true/;

/**
 * Listings from a logged-out search page: [] when Marketplace answered with
 * nothing, null when the page never reached Marketplace (a login wall).
 */
export function parseMarketplaceSearch(html: string, region: SearchRegion): Listing[] | null {
  if (!html.includes('marketplace_listing_title')) {
    // The feed container is the tell: present, Marketplace had nothing; absent, we never got there.
    return html.includes('MarketplaceSearchFeedStories') ? [] : null;
  }

  const starts = [...html.matchAll(RECORD)];
  const seen = new Set<string>();
  const listings: Listing[] = [];

  starts.forEach((match, i) => {
    const id = match[1];
    const record = html.slice(match.index, starts[i + 1]?.index ?? html.length);
    const title = TITLE.exec(record)?.[1];
    // Other story shapes share the feed; only listings have a title.
    if (seen.has(id) || !title || SOLD.test(record)) return;

    const amount = AMOUNT.exec(record)?.[1];
    const formatted = FORMATTED.exec(record)?.[1];
    const price = amount ? Number(amount) : parseMoney(formatted ? unescapeJsonString(formatted) : null);
    if (price === null || !(price > 0)) return; // "Free" and unpriced listings compare to nothing
    seen.add(id);

    const city = CITY.exec(record)?.[1];
    const state = STATE.exec(record)?.[1];
    const photo = PHOTO.exec(record)?.[1];
    const created = Number(CREATED.exec(record)?.[1]);

    listings.push({
      id: `facebook-marketplace:${id}`,
      source: 'facebook-marketplace',
      sourceType: 'marketplace',
      channel: 'local-marketplace',
      url: `${ORIGIN}/marketplace/item/${id}/`,
      title: unescapeJsonString(title),
      price,
      currency: region.currency,
      shipping: 0,
      // Not in the search feed; the matcher reads it from the title.
      condition: 'unknown',
      location: [city ? unescapeJsonString(city) : undefined, state].filter(Boolean).join(', ') || undefined,
      imageUrl: photo ? unescapeJsonString(photo) : undefined,
      imageCount: photo ? 1 : 0,
      postedAt: created > 0 ? new Date(created * 1000).toISOString() : undefined,
      raw: { id, state },
    });
  });
  return listings;
}

/**
 * Facebook pads a thin result with listings from elsewhere; those go. A page
 * that's entirely from somewhere else means the city token is wrong, which
 * is an error rather than a result.
 */
export function keepInProvince(listings: Listing[], province: string, city: string): Listing[] {
  const provinceOf = (listing: Listing) => (listing.raw as { state?: string }).state;
  const local = listings.filter((listing) => !provinceOf(listing) || provinceOf(listing) === province);
  if (local.length === 0 && listings.length >= 5) {
    const elsewhere = [...new Set(listings.map((listing) => listing.location).filter(Boolean))].slice(0, 3);
    throw new Error(`Marketplace "${city}" returned listings from ${elsewhere.join('; ')}: check FACEBOOK_CITY`);
  }
  return local;
}
