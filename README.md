# DealHound

Find the best real deal on a specific product across new, refurbished, and used sources, ranked by **true cost** rather than sticker price:

```
true_cost = price + shipping + estimated_tax + risk_penalty − warranty_value
```

A $1,000 used laptop from a stranger with no photos is not cheaper than a $1,100 certified refurb with a one-year warranty, and DealHound's job is to show that.

**Status:** Phase 1 of 6 (scaffold, types, config, demo data, streaming search). See [Roadmap](#roadmap).

## Quick start

Requires Node.js 20.9 or later.

```bash
npm install
cp .env.example .env.local   # optional: runs on demo data with no keys at all
npm run dev
```

Open http://localhost:3000 and try **M4 MacBook Air 16GB** or **Sony WH-1000XM5**. With no API keys, four demo sources serve fixture listings (see [Demo mode](#demo-mode-and-offline-development)).

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` / `npm start` | Production build / server |

## How it works

1. **Spec parser** (`lib/spec.ts`) turns the query into a structured `ProductSpec`, or asks one clarifying question when a critical attribute is ambiguous (Air or Pro?). *Currently a passthrough; the LLM parser arrives in phase 2.*
2. **Fan-out** (`lib/search.ts`) queries every enabled source in parallel with a 6-second deadline each. Results stream to the browser as Server-Sent Events the moment each source answers. A source that throws, hangs, or returns malformed data is reported as failed and never breaks the search.
3. **Matcher** (`lib/match.ts`, phase 4) keeps listings that match the spec: cheap keyword rules first ("for parts", "box only", "iCloud locked", wrong chip), then an LLM in batches for the uncertain ones.
4. **Scorer** (`lib/score.ts`, phase 4) computes true cost for each match.
5. **Results UI** shows the best new, refurbished, and used picks, then a sortable table (phase 5).

### The streaming API

`POST /api/search` with `{ "query": "…", "postalCode"?: "…", "region"?: "CA" | "US" }` returns `text/event-stream`. Each `data:` line is one JSON `SearchEvent` (see `lib/types.ts`), in this order:

```
spec → sources → (source, listings)* → done
```

`sources` lists every adapter as `pending` or `skipped` (with the reason). Each `source` event reports one adapter finishing as `ok`, `error`, or `timeout`. A query that needs clarifying emits `clarify` instead of `spec`.

## True cost and tuning

Every weight lives in [`lib/config.ts`](lib/config.ts), with comments:

- **Tax:** combined GST/HST + PST/QST by province (from the postal code's first letter). It's not applied to private local sales, and is applied to eBay (which collects it at checkout).
- **Risk penalty:** a share of price, summed from where you buy (retailer < certified refurb < buyer-protected marketplace < local cash sale), condition, seller feedback, a price far below the median of comparable listings (the classic scam signal), and missing photos or descriptions. It's capped at 60%.
- **Warranty value:** months of warranty × a per-month rate, plus a bonus where extended coverage (AppleCare+ and similar) can still be bought.

## Demo mode and offline development

The four demo sources (`lib/sources/demo.ts`) serve fixture listings from `fixtures/demo/` for two products, noise included: cases, "for parts" units, wrong chips, an empty box, an iCloud-locked unit, and a suspiciously cheap "new sealed" listing. That noise is what the phase 4 matcher and scorer must handle.

- `DEMO_MODE=auto` (default): demo sources run only while no real source is configured. `on` always includes them; `off` never does.
- `DEMO_SIMULATE_FAILURES=demo-refurb:error,demo-local:timeout` makes demo sources fail, so you can watch the rest of the search carry on.
- `USE_FIXTURES=1` (phase 3) makes real adapters replay recorded responses from `fixtures/<adapter>/` instead of calling live APIs.

## Getting API keys

Every key is optional; a source without its keys shows as "not configured". Put keys in `.env.local`, never in code. They are read only on the server (`lib/env.ts` is `server-only`) and never reach the browser.

### eBay Browse API (`EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`)

1. Join the [eBay Developers Program](https://developer.ebay.com/join) (free).
2. On [Application Keys](https://developer.ebay.com/my/keys), create a **Production** keyset.
3. Before production keys activate, eBay asks how you handle *Marketplace Account Deletion* notifications. DealHound stores no eBay user data, so you can apply for the exemption.
4. Copy the **App ID** into `EBAY_CLIENT_ID` and the **Cert ID** into `EBAY_CLIENT_SECRET`. DealHound uses the client-credentials OAuth flow, so no eBay login is needed.

### SerpAPI, Google Shopping (`SERPAPI_API_KEY`)

Covers most Canadian retailers (Best Buy, Amazon, Walmart, Costco, Staples, …) through one API.

1. [Sign up](https://serpapi.com/users/sign_up). The free plan includes a monthly search quota.
2. Copy your key from [Manage API Key](https://serpapi.com/manage-api-key).

Results are cached per query (10 minutes by default) to stretch the quota.

### OpenAI (`OPENAI_API_KEY`) or Anthropic (`ANTHROPIC_API_KEY`)

Used for spec parsing and matching (phases 2 and 4). Set `LLM_PROVIDER` to `openai` or `anthropic`.

- OpenAI: create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). API usage is billed separately from ChatGPT.
- Anthropic: create a key at [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys).

Without a key, DealHound falls back to rule-based parsing and matching.

### Other sources

- **Best Buy API** (US region only): [developer.bestbuy.com](https://developer.bestbuy.com/).
- **Apple Certified Refurbished** and **Craigslist** need no key but are off until you opt in (`APPLE_REFURB_ENABLED=1`, `CRAIGSLIST_ENABLED=1`). They respect robots.txt, identify themselves with `DEALHOUND_USER_AGENT`, and cache for at least 30 minutes.
- **Facebook Marketplace and Kijiji are never scraped**; their terms prohibit it. They appear as stubs, with a planned browser extension that analyzes the listing you're already viewing.

## Adding a source adapter

An adapter only fetches and maps. The fan-out handles the timeout, abort, caching, validation, and error isolation.

1. Create `lib/sources/<id>.ts`:

   ```ts
   import 'server-only';
   import { missingEnv, readEnv } from '@/lib/env';
   import type { Listing, SourceAdapter } from '@/lib/types';

   const REQUIRED = ['ACME_API_KEY'] as const;

   interface AcmeItem {
     sku: string;
     url: string;
     name: string;
     price: number;
     shippingCost?: number;
   }

   export const acme: SourceAdapter = {
     id: 'acme',
     name: 'Acme Store',
     type: 'retail',
     requiredEnv: REQUIRED,
     enabled: () => missingEnv(REQUIRED).length === 0,
     async search(spec, { region, signal, limit }) {
       const res = await fetch(`https://api.acme.example/search?q=${encodeURIComponent(spec.searchQuery)}`, {
         headers: { Authorization: `Bearer ${readEnv('ACME_API_KEY')}` },
         signal, // aborted on timeout: always pass it on
       });
       if (!res.ok) throw new Error(`Acme returned HTTP ${res.status}`);
       const data = await res.json();
       return data.items.slice(0, limit).map((item: AcmeItem): Listing => ({
         id: `acme:${item.sku}`,
         source: 'acme',
         sourceType: 'retail',
         channel: 'retailer',
         url: item.url,
         title: item.name,
         price: item.price,
         currency: region.currency,
         shipping: item.shippingCost ?? null, // null = unknown, 0 = free
         condition: 'new',
         raw: item,
       }));
     },
   };
   ```

2. Register it in the `adapters` array in [`lib/sources/index.ts`](lib/sources/index.ts).
3. Add its env vars, with a comment and signup link, to `.env.example`.
4. Record a real response into `fixtures/acme/` and add a test that parses it.

Guidelines:

- Map the source's condition labels onto `Condition` as faithfully as you can. `used` and `unknown` are fine, since the matcher refines them.
- Keep `shipping: null` when the cost is unknown.
- Send keys in headers rather than URLs where the API allows. Error messages are shown in the UI; common key parameters are redacted, but don't rely on that.
- Respect each site's robots.txt and rate limits.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new). The Next.js framework is detected automatically.
3. Add your keys under **Settings → Environment Variables** (same names as `.env.local`).
4. Deploy. Search results stream from a Node.js function (`maxDuration` 30 s).

The in-memory cache lives per server instance, so on Vercel each instance keeps its own. Phase 6 adds Upstash Redis for saved searches and a shared cache.

## Project structure

```
app/
  page.tsx              Search page (server component: region, source list)
  api/search/route.ts   Streaming search endpoint (SSE)
components/             Client UI: search form, source status, listing table
lib/
  types.ts              Listing, ScoredListing, ProductSpec, SourceAdapter, events
  config.ts             Every tunable number: timeouts, tax rates, risk and warranty weights
  schemas.ts            Zod schemas for data crossing trust boundaries
  search.ts             Parallel fan-out with per-source deadline, cache, validation
  sources/              One file per adapter, plus the registry (index.ts)
  spec.ts               Query → ProductSpec (LLM in phase 2)
  cache.ts              Async cache interface; in-memory LRU implementation
  region.ts             Postal code → province, tax lookup
  env.ts                Server-only env access
  sse.ts                Event-stream encoding and parsing
fixtures/demo/          Demo listings (one file per demo source)
tests/                  Vitest
```

## Roadmap

- [x] **1. Scaffold:** types, config, `.env.example`, fixture-backed demo sources, streaming fan-out, basic UI
- [ ] **2. Spec parser:** LLM query → spec, one clarifying question when ambiguous, rule-based fallback
- [ ] **3. Real sources:** eBay, SerpAPI Google Shopping, Apple Certified Refurbished, Craigslist, with recorded fixtures
- [ ] **4. Matcher and scorer:** rules plus batched LLM matching, true cost, tests against fixtures
- [ ] **5. Results UI:** top picks (new / refurb / used) with a one-line why, sortable and filterable table, risk badges
- [ ] **6. Saved searches and alerts:** target true cost, cron re-runs, email or Telegram notifications
