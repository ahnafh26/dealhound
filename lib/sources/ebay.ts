import 'server-only';

import { REGIONS } from '@/lib/config';
import { missingEnv, readEnv } from '@/lib/env';
import { politeFetch, useFixtures } from '@/lib/http';
import type { Condition, Listing, SearchRegion, SourceAdapter } from '@/lib/types';
import { stripHtml, truncate } from './parse';

/**
 * eBay through its official Browse API: an application token (OAuth client
 * credentials, so no eBay login), then one keyword search on the shopper's
 * eBay marketplace. Buy It Now only, because an auction's current bid isn't
 * a price you can pay. Shipping is quoted to the shopper's postal code.
 */

const REQUIRED = ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET'] as const;
const API = 'https://api.ebay.com';

export const ebay: SourceAdapter = {
  id: 'ebay',
  name: 'eBay',
  type: 'marketplace',
  requiredEnv: REQUIRED,
  enabled: () => useFixtures() || missingEnv(REQUIRED).length === 0,
  async search(spec, { region, signal, limit }) {
    const params = new URLSearchParams({
      q: spec.searchQuery,
      limit: String(Math.min(limit, 200)),
      filter: `buyingOptions:{FIXED_PRICE},deliveryCountry:${region.code}`,
    });
    const token = useFixtures() ? 'offline' : await accessToken();
    const response = await politeFetch(`${API}/buy/browse/v1/item_summary/search?${params}`, {
      source: 'ebay',
      fixture: 'search.json',
      signal,
      minIntervalMs: 0,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-ebay-c-marketplace-id': readEnv('EBAY_MARKETPLACE_ID') ?? REGIONS[region.code].ebayMarketplaceId,
        // Where to quote shipping to.
        'x-ebay-c-enduserctx': `contextualLocation=${encodeURIComponent(
          `country=${region.code}${region.postalCode ? `,zip=${region.postalCode.replace(/\s/g, '')}` : ''}`,
        )}`,
      },
    });
    if (!response.ok) throw new Error(`eBay search returned HTTP ${response.status}${ebayError(response.text)}`);
    return parseEbaySearch(JSON.parse(response.text), region);
  },
};

// ─── Access token ────────────────────────────────────────────────────────

interface Token {
  value: string;
  expiresAt: number;
}

// One token (valid ~2 hours) shared by every search, and by concurrent ones while it's being fetched.
const globalForEbay = globalThis as typeof globalThis & { __dealhoundEbayToken?: Promise<Token> };

async function accessToken(): Promise<string> {
  const current = globalForEbay.__dealhoundEbayToken;
  const token = current && (await current.catch(() => null));
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const pending = requestToken();
  globalForEbay.__dealhoundEbayToken = pending;
  pending.catch(() => {
    if (globalForEbay.__dealhoundEbayToken === pending) globalForEbay.__dealhoundEbayToken = undefined;
  });
  return (await pending).value;
}

async function requestToken(): Promise<Token> {
  const credentials = Buffer.from(`${readEnv('EBAY_CLIENT_ID')}:${readEnv('EBAY_CLIENT_SECRET')}`).toString('base64');
  const response = await politeFetch(`${API}/identity/v1/oauth2/token`, {
    source: 'ebay',
    // No fixture: an access token must never be written to disk.
    signal: AbortSignal.timeout(5_000),
    minIntervalMs: 0,
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`eBay didn't accept the API keys (HTTP ${response.status})${ebayError(response.text)}`);
  }
  const body = JSON.parse(response.text) as { access_token: string; expires_in: number };
  return { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
}

/** Forgets the cached token. For tests. */
export function resetEbayToken(): void {
  globalForEbay.__dealhoundEbayToken = undefined;
}

function ebayError(text: string): string {
  try {
    const body = JSON.parse(text) as { errors?: { message?: string }[]; error_description?: string };
    const message = body.errors?.[0]?.message ?? body.error_description;
    return message ? `: ${message.slice(0, 160)}` : '';
  } catch {
    return '';
  }
}

// ─── Parsing ─────────────────────────────────────────────────────────────

// eBay's condition ids, from its developer docs.
const EBAY_CONDITIONS: Record<string, Condition> = {
  '1000': 'new',
  '1500': 'open-box', // New other (see details)
  '1750': 'open-box', // New with defects
  '2000': 'refurb', // Certified refurbished
  '2010': 'refurb', // Excellent - Refurbished
  '2020': 'refurb', // Very Good - Refurbished
  '2030': 'refurb', // Good - Refurbished
  '2500': 'refurb', // Seller refurbished
  '2750': 'used-excellent', // Like New
  '3000': 'used',
  '4000': 'used-excellent', // Very Good
  '5000': 'used-good', // Good
  '6000': 'used-fair', // Acceptable
  '7000': 'parts', // For parts or not working
};

interface EbayItem {
  itemId?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  additionalImages?: { imageUrl?: string }[];
  condition?: string;
  conditionId?: string;
  seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
  shippingOptions?: { shippingCostType?: string; shippingCost?: { value?: string; currency?: string } }[];
  itemLocation?: { city?: string; stateOrProvince?: string; country?: string };
  itemCreationDate?: string;
  shortDescription?: string;
}

export function parseEbaySearch(body: unknown, region: SearchRegion): Listing[] {
  const items = (body as { itemSummaries?: EbayItem[] } | null)?.itemSummaries ?? [];
  return items.flatMap((item): Listing[] => {
    const price = Number(item.price?.value);
    if (!item.itemId || !item.title || !item.itemWebUrl || !Number.isFinite(price)) return [];

    const shippingValue = item.shippingOptions?.[0]?.shippingCost?.value;
    const shipping = shippingValue === undefined ? null : Number(shippingValue);
    const rating = Number(item.seller?.feedbackPercentage);
    const where = item.itemLocation;

    return [
      {
        id: `ebay:${item.itemId}`,
        source: 'ebay',
        sourceType: 'marketplace',
        channel: 'protected-marketplace',
        url: item.itemWebUrl,
        title: item.title,
        price,
        currency: item.price?.currency ?? region.currency,
        shipping: Number.isFinite(shipping) ? shipping : null,
        condition: EBAY_CONDITIONS[item.conditionId ?? ''] ?? 'unknown',
        conditionText: item.condition,
        seller: item.seller?.username,
        sellerRating: Number.isFinite(rating) ? rating : undefined,
        sellerFeedbackCount: item.seller?.feedbackScore,
        location: [where?.city, where?.stateOrProvince ?? where?.country].filter(Boolean).join(', ') || undefined,
        imageUrl: item.image?.imageUrl,
        imageCount: (item.image?.imageUrl ? 1 : 0) + (item.additionalImages?.length ?? 0),
        description: item.shortDescription ? truncate(stripHtml(item.shortDescription)) : undefined,
        postedAt: item.itemCreationDate,
        raw: item,
      },
    ];
  });
}
