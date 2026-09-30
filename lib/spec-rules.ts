import { capitalize } from './attributes';
import type { ClarifyingQuestion, ProductSpec } from './types';

/**
 * Reads a query with rules alone: free and instant, so it always runs first.
 * It knows a few product families well enough to skip the LLM (and to ask
 * about their known ambiguities), and pulls the usual specs out of anything.
 */

export interface RulesResult {
  spec: ProductSpec;
  /** The query names a product family these rules know, so an LLM would add little. */
  confident: boolean;
  /** A known ambiguity worth one question, e.g. "MacBook" without Air or Pro. */
  clarify?: ClarifyingQuestion;
}

type Kind = 'computer' | 'mobile' | 'other';

interface Family {
  brand: string;
  category: string;
  kind: Kind;
  model: string | null;
  /** What to type into a store's search box: the product line, not every spec. */
  searchQuery: string;
  /** The product lines to offer when the family is known but the line isn't. */
  ask?: { attribute: string; question: string; lines: { label: string; searchQuery: string }[] };
}

const CHIP = /\bm([1-9])(?:\s?(pro|max|ultra))?\b/i;
const SIZE = /\b(\d{1,4})\s?(gb|tb)\b(?:\s(ram|memory|unified memory|ssd|storage))?/gi;
const SCREEN = /\b(\d{1,2}(?:\.\d)?)\s?(?:"|”|''|-?\s?inch(?:es)?\b|-?in\b)/i;
const YEAR = /\b(20[1-3]\d)\b/;

// Longest first, so "midnight blue" wins over "midnight".
const COLORS = [
  'natural titanium', 'desert titanium', 'platinum silver', 'midnight blue', 'space black', 'space gray',
  'space grey', 'sky blue', 'midnight', 'starlight', 'graphite', 'silver', 'black', 'white', 'blue',
  'green', 'pink', 'purple', 'red', 'gold',
].map((name) => ({ name, pattern: new RegExp(`\\b${name.replace(' ', '\\s')}\\b`, 'i') }));

const IMPLIED_BRANDS: [RegExp, string][] = [
  [/\b(?:iphone|ipad|imac|mac\s?book|mac\s?mini|mac\s?studio|airpods|apple\s?watch)\b/i, 'Apple'],
  [/\bgalaxy\b/i, 'Samsung'],
  [/\bpixel\b/i, 'Google'],
  [/\bthinkpad\b/i, 'Lenovo'],
  [/\bxps\b/i, 'Dell'],
  [/\b(?:surface|xbox)\b/i, 'Microsoft'],
  [/\b(?:playstation|ps[45])\b/i, 'Sony'],
];

const BRANDS = [
  'Apple', 'Samsung', 'Sony', 'Google', 'Microsoft', 'Dell', 'HP', 'Lenovo', 'ASUS', 'Acer', 'Razer',
  'MSI', 'LG', 'Bose', 'Sennheiser', 'Nintendo', 'Valve', 'Meta', 'DJI', 'GoPro', 'Canon', 'Nikon',
  'Fujifilm', 'Garmin', 'OnePlus', 'Motorola', 'Xiaomi', 'Framework', 'Logitech', 'Dyson',
].map((name) => ({ name, pattern: new RegExp(`\\b${name}\\b`, 'i') }));

const COMPUTER_WORDS =
  /\b(?:laptop|notebook|mac\s?book|chromebook|thinkpad|xps|zenbook|vivobook|ultrabook|desktop|imac|mac\s?mini|mac\s?studio)\b/i;
const MOBILE_WORDS = /\b(?:phone|iphone|galaxy\s?s\d+|pixel\s?\d+|ipad|tablet|galaxy\s?tab)\b/i;

// Words about the purchase rather than the product. In a store's search box they only lose results.
const PURCHASE_WORDS =
  /\b(?:cheap(?:est)?|best|deals?|prices?|buy|for sale|on sale|used|refurb(?:ished)?|renewed|open[- ]box|like new|mint condition)\b/gi;
const BUDGET = /\b(?:under|below|less than|max|up to)\s*\$?\s?\d[\d,.]*\s?k?\b|\$\s?\d[\d,.]*\s?k?\b/gi;

export function parseWithRules(input: string): RulesResult {
  const query = input.replace(/\s+/g, ' ').trim();
  const family = macbook(query) ?? iphone(query) ?? sony1000x(query);
  const brand = family?.brand ?? findBrand(query);
  const { required, optional } = extractAttributes(query, family?.kind ?? guessKind(query), brand === 'Apple');

  const spec: ProductSpec = {
    query,
    searchQuery: family?.searchQuery ?? cleanSearchQuery(query),
    category: family?.category ?? null,
    brand,
    model: family?.model ?? null,
    variant: null,
    required,
    optional,
    parsedBy: 'rules',
  };

  const ask = family?.ask;
  const clarify: ClarifyingQuestion | undefined = ask && {
    attribute: ask.attribute,
    question: ask.question,
    options: ask.lines.map((line) => ({ label: line.label, query: [line.searchQuery, ...refinements(required)].join(' ') })),
  };
  return { spec, confident: family !== null, clarify };
}

/** Removes budget and purchase words, which would only narrow a store's search. */
export function cleanSearchQuery(query: string): string {
  const cleaned = query.replace(BUDGET, ' ').replace(PURCHASE_WORDS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length >= 2 ? cleaned : query;
}

// ─── Families ────────────────────────────────────────────────────────────

const MACBOOK = /\bmac\s?book\b/i;

function macbook(query: string): Family | null {
  if (!MACBOOK.test(query)) return null;
  const chip = CHIP.exec(query);
  const tier = chip?.[2]?.toLowerCase();
  // Look for "Pro" outside the chip name, so an "M4 Pro" chip isn't read as the word Pro twice.
  const rest = chip ? query.replace(chip[0], ' ') : query;
  const saysAir = /\bair\b/i.test(rest);
  const saysPro = /\bpro\b/i.test(rest) || tier === 'pro' || tier === 'max';

  let model: string | null = saysAir === saysPro ? null : saysAir ? 'MacBook Air' : 'MacBook Pro';
  if (!saysAir && !saysPro) {
    // The screen gives the line away: Air comes in 13 and 15 inches, Pro in 14 and 16.
    const inches = screenInches(query);
    if (inches === 13 || inches === 15) model = 'MacBook Air';
    if (inches === 14 || inches === 16) model = 'MacBook Pro';
  }

  return {
    brand: 'Apple',
    category: 'laptop',
    kind: 'computer',
    model,
    searchQuery: [model ?? 'MacBook', chip ? chipLabel(chip) : null].filter(Boolean).join(' '),
    ask: model
      ? undefined
      : {
          attribute: 'model',
          question: 'Which MacBook are you after?',
          lines: [
            { label: 'MacBook Air', searchQuery: 'MacBook Air' },
            { label: 'MacBook Pro', searchQuery: 'MacBook Pro' },
          ],
        },
  };
}

const IPHONE = /\biphone\s?(\d{1,2}e?|se|xr|xs|x)\b(?:\s?(pro\s?max|pro|plus|mini|max))?/i;

function iphone(query: string): Family | null {
  const match = IPHONE.exec(query);
  if (!match) return null;
  const generation = /^\d/.test(match[1]) ? match[1].toLowerCase() : match[1].toUpperCase();
  const tier = match[2]
    ? ` ${match[2].toLowerCase().replace(/pro\s?max/, 'pro max').split(' ').map(capitalize).join(' ')}`
    : '';
  const model = `iPhone ${generation}${tier}`;
  return { brand: 'Apple', category: 'phone', kind: 'mobile', model, searchQuery: model };
}

const SONY_1000X = /\b(?:(wh|wf)\s?-?\s?)?1000\s?-?\s?x\s?m\s?(\d)\b/i;
const SONY_XM = /\bxm\s?(\d)\b/i;

function sony1000x(query: string): Family | null {
  const full = SONY_1000X.exec(query);
  const short = full ? null : /\bsony\b/i.test(query) ? SONY_XM.exec(query) : null;
  if (!full && !short) return null;

  const generation = full ? full[2] : short![1];
  const line = full?.[1]?.toUpperCase();
  if (line) {
    const model = `${line}-1000XM${generation}`;
    const category = line === 'WH' ? 'headphones' : 'earbuds';
    return { brand: 'Sony', category, kind: 'other', model, searchQuery: `Sony ${model}` };
  }
  return {
    brand: 'Sony',
    category: 'headphones',
    kind: 'other',
    model: null,
    searchQuery: `Sony 1000XM${generation}`,
    ask: {
      attribute: 'model',
      question: 'Over-ear headphones or earbuds?',
      lines: [
        { label: `WH-1000XM${generation} (over-ear)`, searchQuery: `Sony WH-1000XM${generation}` },
        { label: `WF-1000XM${generation} (earbuds)`, searchQuery: `Sony WF-1000XM${generation}` },
      ],
    },
  };
}

// ─── Attributes ──────────────────────────────────────────────────────────

function extractAttributes(query: string, kind: Kind, apple: boolean) {
  const required: Record<string, string> = {};
  const optional: Record<string, string> = {};

  // "M4" is a chip only for Apple; elsewhere it could be a BMW.
  const chip = apple ? CHIP.exec(query) : null;
  if (chip) required.chip = chipLabel(chip);

  for (const match of query.matchAll(SIZE)) {
    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();
    const hint = match[3]?.toLowerCase();
    // Without a hint, a small GB figure on a computer is memory; anything else is storage.
    const isRam = hint ? /ram|memory/.test(hint) : kind === 'computer' && unit === 'GB' && amount <= 64;
    required[isRam ? 'ram' : 'storage'] ??= `${amount}${unit}`;
  }

  const inches = SCREEN.exec(query);
  if (inches && isScreenSize(Number(inches[1]))) required.screen = `${inches[1]}-inch`;

  const year = YEAR.exec(query);
  if (year) required.year = year[1];

  const color = COLORS.find(({ pattern }) => pattern.test(query));
  if (color) optional.color = color.name.split(' ').map(capitalize).join(' ');

  return { required, optional };
}

/** The specs worth carrying into a refined query: they narrow the product, not the listing. */
function refinements(required: Record<string, string>): string[] {
  return ['chip', 'ram', 'storage', 'screen', 'year'].flatMap((key) => (required[key] ? [required[key]] : []));
}

function chipLabel(match: RegExpExecArray): string {
  return match[2] ? `M${match[1]} ${capitalize(match[2])}` : `M${match[1]}`;
}

function screenInches(query: string): number | null {
  const match = SCREEN.exec(query);
  const size = match ? Number(match[1]) : NaN;
  return isScreenSize(size) ? Math.floor(size) : null;
}

// Rules out "2-in-1" and the like: real screens run from phones to TVs.
function isScreenSize(inches: number): boolean {
  return inches >= 5 && inches <= 100;
}

function findBrand(query: string): string | null {
  for (const [pattern, brand] of IMPLIED_BRANDS) if (pattern.test(query)) return brand;
  return BRANDS.find(({ pattern }) => pattern.test(query))?.name ?? null;
}

function guessKind(query: string): Kind {
  if (COMPUTER_WORDS.test(query)) return 'computer';
  if (MOBILE_WORDS.test(query)) return 'mobile';
  return 'other';
}
