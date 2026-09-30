import { TimeoutError } from './async';
import { getCache, type Cache } from './cache';
import { SEARCH } from './config';
import { ListingSchema } from './schemas';
import type {
  ClientListing,
  Listing,
  ProductSpec,
  SearchOptions,
  SourceAdapter,
  SourceState,
  SourceStatus,
} from './types';

export interface SourceOutcome {
  status: SourceStatus;
  listings: Listing[];
}

export interface FanOutOptions extends SearchOptions {
  /** Per-source deadline. Defaults to SEARCH.sourceTimeoutMs. */
  timeoutMs?: number;
  cache?: Cache;
}

export function sourceStatus(
  adapter: SourceAdapter,
  state: SourceState,
  extra: Partial<SourceStatus> = {},
): SourceStatus {
  return { id: adapter.id, name: adapter.name, type: adapter.type, demo: adapter.demo ?? false, state, ...extra };
}

/**
 * Queries every adapter in parallel and reports each one the moment it
 * settles. A source that throws or hangs never holds up or breaks the others.
 */
export function fanOut(
  adapters: SourceAdapter[],
  spec: ProductSpec,
  opts: FanOutOptions,
  onOutcome?: (outcome: SourceOutcome) => void,
): Promise<SourceOutcome[]> {
  return Promise.all(
    adapters.map(async (adapter) => {
      const outcome = await runSource(adapter, spec, opts);
      try {
        onOutcome?.(outcome);
      } catch (err) {
        console.error(`[search] outcome handler failed for ${adapter.id}`, err);
      }
      return outcome;
    }),
  );
}

/** Runs one adapter under a hard deadline. Never throws: failures come back as an error or timeout status. */
export async function runSource(
  adapter: SourceAdapter,
  spec: ProductSpec,
  opts: FanOutOptions,
): Promise<SourceOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const cache = opts.cache ?? getCache();
  const key = cacheKey(adapter, spec, opts);

  const hit = await cache.get<Listing[]>(key).catch(() => undefined);
  if (hit) {
    return { status: sourceStatus(adapter, 'ok', { count: hit.length, ms: elapsed(), cached: true }), listings: hit };
  }

  const timeoutMs = opts.timeoutMs ?? SEARCH.sourceTimeoutMs;
  const controller = new AbortController();
  const cancel = () => controller.abort(opts.signal.reason);
  if (opts.signal.aborted) cancel();
  else opts.signal.addEventListener('abort', cancel, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Racing a deadline (not just aborting) also covers adapters that ignore their signal.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const timeout = new TimeoutError(timeoutMs);
      controller.abort(timeout);
      reject(timeout);
    }, timeoutMs);
  });

  try {
    const results = await Promise.race([
      adapter.search(spec, { region: opts.region, limit: opts.limit, signal: controller.signal }),
      deadline,
    ]);
    const listings = keepValid(adapter.id, results).slice(0, opts.limit);
    await cache.set(key, listings, adapter.cacheTtlMs ?? SEARCH.cacheTtlMs).catch(() => undefined);
    return { status: sourceStatus(adapter, 'ok', { count: listings.length, ms: elapsed() }), listings };
  } catch (err) {
    const reason: unknown = controller.signal.reason;
    const status =
      reason instanceof TimeoutError
        ? sourceStatus(adapter, 'timeout', { detail: reason.message, ms: elapsed() })
        : sourceStatus(adapter, 'error', { detail: describeError(err), ms: elapsed() });
    return { status, listings: [] };
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', cancel);
  }
}

function cacheKey(adapter: SourceAdapter, spec: ProductSpec, { region }: SearchOptions): string {
  const query = spec.searchQuery.toLowerCase().replace(/\s+/g, ' ').trim();
  // Shipping estimates depend on where the buyer is, so cache per postal area.
  const area = region.postalCode?.slice(0, 3) ?? region.subdivision;
  return `search:${adapter.id}:${region.code}:${area}:${query}`;
}

/** Drops listings that fail validation, so one malformed item can't break a source. */
function keepValid(sourceId: string, results: unknown): Listing[] {
  if (!Array.isArray(results)) throw new Error('Adapter returned something other than a list');
  const valid: Listing[] = [];
  for (const item of results) {
    const check = ListingSchema.safeParse(item);
    if (check.success) {
      valid.push(item as Listing);
    } else {
      const issue = check.error.issues[0];
      console.warn(`[${sourceId}] dropped a malformed listing: ${issue?.path.join('.')} ${issue?.message}`);
    }
  }
  return valid;
}

const SECRET_QUERY_PARAM = /([?&](?:api_?key|key|token|access_token|client_secret)=)[^&\s]+/gi;

/** Error text that is safe to show in the UI: secrets redacted, length capped. */
export function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const safe = message.replace(SECRET_QUERY_PARAM, '$1***').replace(/\bBearer\s+\S+/gi, 'Bearer ***');
  return (safe.length > 160 ? `${safe.slice(0, 159)}…` : safe) || 'Unknown error';
}

export function toClientListing({ raw: _raw, ...listing }: Listing): ClientListing {
  return listing;
}
