# DealHound

Find the best real deal on a specific product across new, refurbished, and used sources, ranked by **true cost** rather than sticker price:

```
true_cost = price + shipping + estimated_tax + risk_penalty − warranty_value
```

A $1,000 used laptop from a stranger with no photos is not cheaper than a $1,100 certified refurb with a one-year warranty, and DealHound's job is to show that.

**Status:** Phase 3 of 6 (real sources: eBay, Google Shopping, Apple Refurbished, Kijiji, Facebook Marketplace, Craigslist). See [Roadmap](#roadmap).

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

1. **Spec parser** (`lib/spec.ts`) turns the query into a structured `ProductSpec`: brand, model, the specs a listing must have (`{ chip: 'M4', ram: '16GB' }`) and a short search string for the stores. If a detail that changes the product is ambiguous (MacBook Air or Pro?), it asks one clarifying question instead of guessing. Rules (`lib/spec-rules.ts`) read common products for free and instantly. Only the queries they can't place go to the LLM, and its answers are cached for a day. See [LLM](#llm-query-parsing-and-later-matching).
2. **Fan-out** (`lib/search.ts`) queries every enabled source in parallel with a 6-second deadline each. Results stream to the browser as Server-Sent Events the moment each source answers. A source that throws, hangs, or returns malformed data is reported as failed and never breaks the search.
3. **Matcher** (`lib/match.ts`, phase 4) keeps listings that match the spec: cheap keyword rules first ("for parts", "box only", "iCloud locked", wrong chip), then an LLM in batches for the uncertain ones.
4. **Scorer** (`lib/score.ts`, phase 4) computes true cost for each match.
5. **Results UI** shows the best new, refurbished, and used picks, then a sortable table (phase 5).

### The streaming API

`POST /api/search` with `{ "query": "…", "postalCode"?: "…", "region"?: "CA" | "US", "clarify"?: false }` returns `text/event-stream`. Each `data:` line is one JSON `SearchEvent` (see `lib/types.ts`), in this order:

```
spec → sources → (source, listings)* → done
```

`sources` lists every adapter as `pending` or `skipped` (with the reason). Each `source` event reports one adapter finishing as `ok`, `error`, or `timeout`. A query that needs clarifying emits a single `clarify` event instead, whose options are ready-to-run refined queries. Send `"clarify": false` to search the query as typed.

`POST /api/clarify` with `{ "query": "…" }` returns the same reading as plain JSON without searching, which is handy for checking how a query will be understood:

```bash
curl -s localhost:3000/api/clarify -H 'content-type: application/json' -d '{"query":"Sony XM5"}'
```

## True cost and tuning

Every weight lives in [`lib/config.ts`](lib/config.ts), with comments:

- **Tax:** combined GST/HST + PST/QST by province (from the postal code's first letter). It's not applied to private local sales, and is applied to eBay (which collects it at checkout).
- **Risk penalty:** a share of price, summed from where you buy (retailer < certified refurb < buyer-protected marketplace < local cash sale), condition, seller feedback, a price far below the median of comparable listings (the classic scam signal), and missing photos or descriptions. It's capped at 60%.
- **Warranty value:** months of warranty × a per-month rate, plus a bonus where extended coverage (AppleCare+ and similar) can still be bought.

## Demo mode and offline development

The four demo sources (`lib/sources/demo.ts`) serve fixture listings from `fixtures/demo/` for two products, noise included: cases, "for parts" units, wrong chips, an empty box, an iCloud-locked unit, and a suspiciously cheap "new sealed" listing. That noise is what the phase 4 matcher and scorer must handle.

- `DEMO_MODE=auto` (default): demo sources run only while no real source is configured. `on` always includes them; `off` never does.
- `DEMO_SIMULATE_FAILURES=demo-refurb:error,demo-local:timeout` makes demo sources fail, so you can watch the rest of the search carry on.
- `USE_FIXTURES=1` makes every real source replay its response from `fixtures/<source>/` with no network and no keys. Results are then the same whatever you search.
- `RECORD_FIXTURES=1` saves each live response to `fixtures/<source>/`, so the next offline session replays real data. Access tokens are never saved. The fixtures in the repo are hand-made in each site's format (see `fixtures/README.md`) until you record your own.

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

### LLM: query parsing (and, later, matching)

DealHound works without any LLM: rules read the products they know (MacBooks, iPhones, Sony's 1000X headphones) and extract the usual specs from anything else. An LLM only improves queries the rules can't place, so it's set up to be as cheap as possible:

| `LLM_PROVIDER` | Model | Price per 1M tokens (in / out, Sept 2026) | Key |
| --- | --- | --- | --- |
| `openai` (default) | `gpt-5-nano`, minimal reasoning | $0.05 / $0.40 | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → `OPENAI_API_KEY` |
| `gemini` | `gemini-2.5-flash-lite`, thinking off | free within Google's daily limits, then $0.10 / $0.40 | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → `GEMINI_API_KEY` |
| `custom` | anything OpenAI-compatible (Groq, OpenRouter, Ollama) | varies | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| `none` | rules only | $0 | none |

Reading a query takes about 1,000 input tokens (mostly the fixed instructions and schema) and 200 output tokens, so gpt-5-nano costs roughly $0.0001 per query the rules can't place: about $1 for 7,500 of them. Cached repeats cost nothing. OpenAI API usage is billed separately from ChatGPT and needs a few dollars of prepaid credit. Anthropic's cheapest model (Claude Haiku 4.5, $1 / $5) costs about 20× more for this job, so it isn't wired up.

All providers go through one small OpenAI-compatible client (`lib/llm.ts`) with strict JSON-schema output, validated with Zod. If the LLM errors, times out (8 s) or returns something off-schema, the rules' reading is used instead.

### Best Buy (`BESTBUY_API_KEY`, US only)

[developer.bestbuy.com](https://developer.bestbuy.com/). Used only when the region is US; Google Shopping covers Best Buy Canada.

## How each source is read

Every request goes through `lib/http.ts`. It spaces out requests to each site, rests a source for 30 minutes after any refusal (HTTP 403, 429, or a login wall), and records or replays fixtures.

| Source | How | Identifies as | Turn on with | Cached |
| --- | --- | --- | --- | --- |
| eBay | Official Browse API, Buy It Now only, shipping quoted to your postal code | `DEALHOUND_USER_AGENT` | `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET` | 10 min |
| Google Shopping | SerpAPI (Best Buy, Amazon, Walmart, Costco, Staples, …) | `DEALHOUND_USER_AGENT` | `SERPAPI_API_KEY` | 1 h |
| Best Buy (US) | Official Products API | `DEALHOUND_USER_AGENT` | `BESTBUY_API_KEY` | 10 min |
| Apple Certified Refurbished | Public refurbished-store page, only where robots.txt allows | `DEALHOUND_USER_AGENT` | `APPLE_REFURB_ENABLED=1` | 30 min |
| Kijiji | Search page's embedded listing data, logged out | desktop Chrome | `KIJIJI_ENABLED=1` | 30 min |
| Facebook Marketplace | Logged-out search page's embedded listing data | desktop Chrome | `FACEBOOK_ENABLED=1` | 30 min |
| Craigslist | Public JSON feed behind its search page | desktop Chrome | `CRAIGSLIST_ENABLED=1` | 30 min |

**Kijiji, Facebook Marketplace and Craigslist are read the way [carbuyer](https://github.com/Dropio12/used-car-deal-finder) reads them.** Their terms of use prohibit automated access. These adapters accept that risk for personal, low-volume use and keep it small:
- they're off until you turn them on
- one request per search per site, at least 3 seconds apart
- results cached for 30 minutes
- logged out, with no cookies and no proxies
- a 30-minute rest after any refusal or login wall

The likely consequence of misuse is your IP address getting blocked. Serverless hosts like Vercel use datacenter addresses these sites block sooner than a home connection. Details worth knowing:
- **Location:** each searches your province's main city by default (Toronto or Montréal for Facebook and Craigslist, the province for Kijiji). Elsewhere, set `FACEBOOK_CITY`, `CRAIGSLIST_SITES` or `KIJIJI_LOCATION` (see `.env.example`). City tokens and area ids are never guessed, because a wrong one silently returns another city's listings.
- **Facebook** returns about 24 listings per request with no description or condition. Listings padded in from other provinces are dropped.
- **Condition** isn't in Craigslist's or Facebook's search data, so those listings arrive as `unknown` and the phase 4 matcher reads it from the title.

## Adding a source adapter

An adapter only fetches and maps. The fan-out handles the timeout, abort, caching, validation, and error isolation.

1. Create `lib/sources/<id>.ts`:

   ```ts
   import 'server-only';
   import { missingEnv, readEnv } from '@/lib/env';
   import { fixtureMode, politeFetch } from '@/lib/http';
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
     enabled: () => fixtureMode() || missingEnv(REQUIRED).length === 0,
     async search(spec, { region, signal, limit }) {
       const response = await politeFetch(
         `https://api.acme.example/search?q=${encodeURIComponent(spec.searchQuery)}`,
         {
           source: 'acme',
           fixture: 'search.json', // recorded with RECORD_FIXTURES=1, replayed with USE_FIXTURES=1
           signal, // aborted on timeout: always pass it on
           headers: { Authorization: `Bearer ${readEnv('ACME_API_KEY')}` },
         },
       );
       if (!response.ok) throw new Error(`Acme returned HTTP ${response.status}`);
       const data = JSON.parse(response.text) as { items: AcmeItem[] };
       return data.items.slice(0, limit).map((item): Listing => ({
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
4. Record a real response with `RECORD_FIXTURES=1` (it lands in `fixtures/acme/`), then add a test that parses it (see `tests/sources/`).

Guidelines:

- Map the source's condition labels onto `Condition` as faithfully as you can. `used` and `unknown` are fine, since the matcher refines them.
- Keep `shipping: null` when the cost is unknown.
- Send keys in headers rather than URLs where the API allows. Error messages are shown in the UI; common key parameters are redacted, but don't rely on that.
- For web pages, pass `robots: true` to `politeFetch` so robots.txt is honoured. If a page shows a block or login wall, `throw reportBlocked(source, reason)` so the source backs off instead of retrying.

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
  api/clarify/route.ts  How a query will be read, as JSON, without searching
components/             Client UI: search form, source status, spec summary, listing table
lib/
  types.ts              Listing, ScoredListing, ProductSpec, SourceAdapter, events
  config.ts             Every tunable number: timeouts, tax rates, risk and warranty weights
  schemas.ts            Zod schemas for data crossing trust boundaries
  search.ts             Parallel fan-out with per-source deadline, cache, validation
  sources/              One file per adapter, the registry (index.ts), shared parse helpers
  http.ts               Polite fetching: spacing, back-off, robots.txt, fixture record/replay
  spec.ts               Query → ProductSpec or a clarifying question (rules, then LLM)
  spec-rules.ts         The free rules reader: known product families + spec extraction
  attributes.ts         Shared attribute names and value formats ("16 gb" → "16GB")
  llm.ts                Tiny OpenAI-compatible client for JSON-only calls
  cache.ts              Async cache interface; in-memory LRU implementation
  region.ts             Postal code → province, tax lookup
  env.ts                Server-only env access
  sse.ts                Event-stream encoding and parsing
fixtures/demo/          Demo listings (one file per demo source)
fixtures/<source>/      One response per real source, replayed with USE_FIXTURES=1
tests/                  Vitest
```

## Roadmap

- [x] **1. Scaffold:** types, config, `.env.example`, fixture-backed demo sources, streaming fan-out, basic UI
- [x] **2. Spec parser:** rules first, the cheapest LLM for the rest, one clarifying question when ambiguous
- [x] **3. Real sources:** eBay, Google Shopping (SerpAPI), Best Buy US, Apple Certified Refurbished, and Kijiji, Facebook Marketplace and Craigslist read like carbuyer, all replayable offline
- [ ] **4. Matcher and scorer:** rules plus batched LLM matching, true cost, tests against fixtures
- [ ] **5. Results UI:** top picks (new / refurb / used) with a one-line why, sortable and filterable table, risk badges
- [ ] **6. Saved searches and alerts:** target true cost, cron re-runs, email or Telegram notifications
