/**
 * Core domain types, shared by the server (API routes, adapters, scorer) and
 * the browser (results UI). Nothing here may import server-only code.
 */

export const REGION_CODES = ['CA', 'US'] as const;
export type RegionCode = (typeof REGION_CODES)[number];

/** How a source sells: a retailer, a refurbisher, or a marketplace of individual sellers. */
export const SOURCE_TYPES = ['retail', 'refurb', 'marketplace'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Where a listing is actually bought, ordered from safest to riskiest. Finer
 * than SourceType because marketplaces differ a lot: eBay's Money Back
 * Guarantee is not cash in a parking lot. Drives the risk penalty and whether
 * sales tax applies.
 */
export const CHANNELS = [
  'retailer',
  'certified-refurb',
  'protected-marketplace',
  'local-marketplace',
] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * Normalized item condition. Adapters map the source's label onto this scale;
 * `used` (ungraded) and `unknown` are refined by the matcher from the title
 * and description.
 */
export const CONDITIONS = [
  'new',
  'open-box',
  'refurb',
  'used-excellent',
  'used-good',
  'used-fair',
  'used',
  'parts',
  'unknown',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export interface Listing {
  /** Globally unique: `${source}:${source's own item id}`. */
  id: string;
  /** Adapter id, e.g. `ebay`. */
  source: string;
  sourceType: SourceType;
  channel: Channel;
  url: string;
  title: string;
  /** Item price in `currency`, excluding shipping and tax. */
  price: number;
  /** ISO 4217, e.g. `CAD`. */
  currency: string;
  /** In `currency`. 0 = free shipping or local pickup; null = unknown. */
  shipping: number | null;
  condition: Condition;
  /** The source's own condition label, e.g. "Seller refurbished". */
  conditionText?: string;
  /** Store or seller name. */
  seller?: string;
  /** Percent positive feedback, 0–100. */
  sellerRating?: number;
  sellerFeedbackCount?: number;
  location?: string;
  imageUrl?: string;
  imageCount?: number;
  description?: string;
  /** Warranty the source states outright. The matcher may also find one in the text. */
  warrantyMonths?: number;
  /** ISO 8601. */
  postedAt?: string;
  /** The untouched source payload, for debugging. Never sent to the browser. */
  raw: unknown;
}

/** A listing as sent to the browser. */
export type ClientListing = Omit<Listing, 'raw'>;

export type MatchStatus = 'match' | 'mismatch' | 'uncertain';

/** Every term of the true-cost formula, so the UI can explain a number. */
export interface CostBreakdown {
  price: number;
  shipping: number;
  tax: number;
  riskPenalty: number;
  warrantyValue: number;
}

export interface ScoredListing extends Listing {
  matchStatus: MatchStatus;
  /** 0–1. */
  matchConfidence: number;
  /** Specs the matcher found in the listing, e.g. { chip: 'M4', ram: '16GB' }. */
  extractedSpecs: Record<string, string>;
  /** price + shipping + tax + riskPenalty − warrantyValue, in the region's currency. */
  trueCost: number;
  costBreakdown: CostBreakdown;
  /** 0–1: expected loss as a share of price. */
  riskScore: number;
  riskReasons: string[];
  warrantyMonths: number;
}

/** A structured reading of what the user is shopping for. */
export interface ProductSpec {
  /** What the user typed. */
  query: string;
  /** The query string sent to each source's search. */
  searchQuery: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  variant: string | null;
  /** Attributes a listing must have, normalized, e.g. { chip: 'M4', ram: '16GB' }. */
  required: Record<string, string>;
  /** Nice-to-haves that never disqualify a listing, e.g. { color: 'Midnight' }. */
  optional: Record<string, string>;
  parsedBy: 'llm' | 'rules' | 'passthrough';
}

export interface ClarifyingQuestion {
  /** The ambiguous attribute, e.g. `model`. */
  attribute: string;
  question: string;
  /** Clicking an option runs a new search with its `query`. */
  options: { label: string; query: string }[];
}

export type SpecResult =
  | { kind: 'spec'; spec: ProductSpec }
  | { kind: 'clarify'; question: ClarifyingQuestion };

/** Where the shopper is: drives currency, tax, and shipping estimates. */
export interface SearchRegion {
  code: RegionCode;
  currency: string;
  /** Normalized postal/ZIP code, when the user gave a valid one. */
  postalCode?: string;
  /** Province or state used for tax, e.g. `ON`. */
  subdivision: string;
  subdivisionSource: 'postal-code' | 'default';
}

export interface SearchOptions {
  region: SearchRegion;
  /** Aborted when the per-source timeout fires or the shopper cancels. */
  signal: AbortSignal;
  /** Maximum listings to return. */
  limit: number;
}

export interface SourceAdapter {
  id: string;
  name: string;
  type: SourceType;
  /** Env vars the adapter needs. Listed in the UI when missing. */
  requiredEnv?: readonly string[];
  /** Regions the adapter serves. Omit for all. */
  regions?: readonly RegionCode[];
  /** How long to cache results. Defaults to SEARCH.cacheTtlMs. */
  cacheTtlMs?: number;
  /** Serves fixture data rather than live listings. */
  demo?: boolean;
  /** False when keys are missing or the adapter is switched off. */
  enabled(): boolean;
  /** Why enabled() is false, shown in the UI. */
  disabledReason?(): string;
  search(spec: ProductSpec, opts: SearchOptions): Promise<Listing[]>;
}

export type SourceState = 'pending' | 'ok' | 'error' | 'timeout' | 'skipped';

export interface SourceStatus {
  id: string;
  name: string;
  type: SourceType;
  demo: boolean;
  state: SourceState;
  /** Why the source was skipped or failed. */
  detail?: string;
  count?: number;
  ms?: number;
  cached?: boolean;
}

/** Messages streamed from /api/search, in order: spec → sources → (source, listings)* → done. */
export type SearchEvent =
  | { type: 'spec'; spec: ProductSpec; region: SearchRegion }
  | { type: 'clarify'; question: ClarifyingQuestion }
  | { type: 'sources'; sources: SourceStatus[] }
  | { type: 'source'; source: SourceStatus }
  | { type: 'listings'; source: string; listings: ClientListing[] }
  | { type: 'done'; ms: number; total: number }
  | { type: 'error'; message: string };
