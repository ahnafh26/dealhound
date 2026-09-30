/**
 * Every tunable number in DealHound lives here: timeouts, cache TTLs, regions,
 * tax rates, and the weights behind true cost:
 *
 *   true_cost = price + shipping + estimated_tax + risk_penalty − warranty_value
 *
 * Risk and warranty are fractions of the item price, so one set of weights
 * works for a $40 accessory and a $2,000 laptop. This file holds no secrets
 * and is safe to import from the browser.
 */

import type { Channel, Condition, RegionCode } from './types';

// ─── Search ──────────────────────────────────────────────────────────────

export const SEARCH = {
  /** A source that hasn't answered by now is reported as timed out; the rest carry on. */
  sourceTimeoutMs: 6_000,
  maxListingsPerSource: 50,
  /** Default cache per source + query. Adapters can ask for longer (Apple refurb: 30 min). */
  cacheTtlMs: 10 * 60_000,
  queryMaxLength: 200,
};

export const CACHE = {
  maxEntries: 500,
};

// ─── Regions ─────────────────────────────────────────────────────────────

export interface RegionConfig {
  code: RegionCode;
  name: string;
  currency: string;
  locale: string;
  postalCodeLabel: string;
  postalCodePlaceholder: string;
  /** Tax subdivision used when the postal code is missing or unrecognized. */
  defaultSubdivision: string;
  ebayMarketplaceId: string;
  /** Google `gl` country code, for SerpAPI. */
  googleCountry: string;
}

export const REGIONS: Record<RegionCode, RegionConfig> = {
  CA: {
    code: 'CA',
    name: 'Canada',
    currency: 'CAD',
    locale: 'en-CA',
    postalCodeLabel: 'Postal code',
    postalCodePlaceholder: 'M5V 3L9',
    defaultSubdivision: 'ON',
    ebayMarketplaceId: 'EBAY_CA',
    googleCountry: 'ca',
  },
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    locale: 'en-US',
    postalCodeLabel: 'ZIP code',
    postalCodePlaceholder: '10001',
    defaultSubdivision: 'US',
    ebayMarketplaceId: 'EBAY_US',
    googleCountry: 'us',
  },
};

/** Used when DEFAULT_REGION isn't set. */
export const FALLBACK_REGION: RegionCode = 'CA';

// ─── Sales tax ───────────────────────────────────────────────────────────

export interface TaxRate {
  name: string;
  rate: number;
  label: string;
}

/**
 * Combined GST/HST + provincial sales tax, by province/territory. Current as
 * of 2026 (Nova Scotia's HST dropped to 14% in April 2025). Re-check when a
 * province changes its rate.
 */
export const CA_TAX: Record<string, TaxRate> = {
  AB: { name: 'Alberta', rate: 0.05, label: 'GST 5%' },
  BC: { name: 'British Columbia', rate: 0.12, label: 'GST 5% + PST 7%' },
  MB: { name: 'Manitoba', rate: 0.12, label: 'GST 5% + RST 7%' },
  NB: { name: 'New Brunswick', rate: 0.15, label: 'HST 15%' },
  NL: { name: 'Newfoundland and Labrador', rate: 0.15, label: 'HST 15%' },
  NS: { name: 'Nova Scotia', rate: 0.14, label: 'HST 14%' },
  NT: { name: 'Northwest Territories', rate: 0.05, label: 'GST 5%' },
  NU: { name: 'Nunavut', rate: 0.05, label: 'GST 5%' },
  ON: { name: 'Ontario', rate: 0.13, label: 'HST 13%' },
  PE: { name: 'Prince Edward Island', rate: 0.15, label: 'HST 15%' },
  QC: { name: 'Quebec', rate: 0.14975, label: 'GST 5% + QST 9.975%' },
  SK: { name: 'Saskatchewan', rate: 0.11, label: 'GST 5% + PST 6%' },
  YT: { name: 'Yukon', rate: 0.05, label: 'GST 5%' },
};

/** US sales tax varies by state and city; one estimate keeps US mode usable. */
export const US_TAX: TaxRate = { name: 'United States', rate: 0.08, label: 'Sales tax ~8% (est.)' };

export const TAX_RULES = {
  /**
   * Whether tax is added on top of the listed price. Private sellers don't
   * charge it; eBay collects it at checkout for Canadian buyers.
   */
  appliesTo: {
    retailer: true,
    'certified-refurb': true,
    'protected-marketplace': true,
    'local-marketplace': false,
  } satisfies Record<Channel, boolean>,
  /** Shipping is taxed at the item's rate in Canada. */
  taxShipping: true,
};

// ─── Shipping ────────────────────────────────────────────────────────────

export const SHIPPING = {
  /** Assumed cost when a listing that ships doesn't say what shipping costs. */
  unknownEstimate: 20,
};

// ─── Risk penalty ────────────────────────────────────────────────────────
// risk_penalty = min(sum of the rates that apply, maxRate) × (price + shipping)
// Read each rate as the expected loss (money, time, hassle) as a share of price.

export const RISK = {
  /** Baseline by where you buy: retailer < certified refurb < eBay-style < local. */
  channel: {
    retailer: 0,
    'certified-refurb': 0.01,
    'protected-marketplace': 0.04,
    'local-marketplace': 0.1,
  } satisfies Record<Channel, number>,

  /** Chance of hidden defects, by condition. */
  condition: {
    new: 0,
    'open-box': 0.005,
    refurb: 0.01,
    'used-excellent': 0.01,
    'used-good': 0.02,
    'used-fair': 0.05,
    used: 0.03,
    parts: 0.5,
    unknown: 0.03,
  } satisfies Record<Condition, number>,

  /** Only applied where the source reports seller feedback. */
  seller: {
    /** Fewer ratings than this reads as a new or throwaway account. */
    minFeedbackCount: 20,
    lowFeedbackRate: 0.04,
    /** Positive-feedback % at or above this costs nothing. */
    goodRating: 99,
    /** Between okRating and goodRating. */
    okRating: 97,
    okRatingRate: 0.02,
    /** Below okRating. */
    poorRatingRate: 0.06,
  },

  /** A price far below the median of comparable matched listings is the classic scam signal. */
  priceAnomaly: {
    /** Need at least this many comparable listings to judge. */
    minComparables: 4,
    suspiciousRatio: 0.65,
    suspiciousRate: 0.1,
    scamRatio: 0.45,
    scamRate: 0.3,
  },

  listingQuality: {
    noPhotoRate: 0.03,
    /** Only checked where the source provides descriptions. */
    minDescriptionChars: 40,
    thinDescriptionRate: 0.02,
  },

  maxRate: 0.6,

  /** riskScore at or below `lowMax` shows a Low badge, at or below `mediumMax` Medium, above that High. */
  badge: { lowMax: 0.05, mediumMax: 0.12 },
};

// ─── Warranty value ──────────────────────────────────────────────────────
// warranty_value = (min(months × perMonthRate, maxRate) + extended-coverage bonus) × price

export const WARRANTY = {
  /** Assumed when the listing doesn't state a warranty. Certified refurb sources set 12 explicitly. */
  defaultMonths: {
    new: 12,
    'open-box': 12,
    refurb: 3,
    'used-excellent': 0,
    'used-good': 0,
    'used-fair': 0,
    used: 0,
    parts: 0,
    unknown: 0,
  } satisfies Record<Condition, number>,
  /** 12 months ≈ 4.8% of price. */
  perMonthRate: 0.004,
  maxRate: 0.12,
  /** Bonus when extended coverage can be bought (AppleCare+, manufacturer plans): new items and certified refurbs. */
  extendedCoverage: {
    rate: 0.02,
    conditions: ['new'] as Condition[],
    channels: ['certified-refurb'] as Channel[],
  },
};
