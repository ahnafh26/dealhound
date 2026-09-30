'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { RegionConfig } from '@/lib/config';
import { formatDuration } from '@/lib/format';
import { readEvents } from '@/lib/sse';
import type { ClarifyingQuestion, ClientListing, ProductSpec, SearchEvent, SourceStatus } from '@/lib/types';
import { landedPrice, ListingTable } from './ListingTable';
import { SearchForm } from './SearchForm';
import { SourceStatusList } from './SourceStatusList';
import { SpecSummary } from './SpecSummary';

interface SearchAppProps {
  region: RegionConfig;
  /** From ?q= — searched immediately on load. */
  initialQuery: string;
  initialSources: SourceStatus[];
  defaultPostalCode: string;
}

interface SearchState {
  phase: 'idle' | 'searching' | 'done' | 'failed';
  /** The query of the current or most recent search. */
  query: string;
  spec?: ProductSpec;
  sources: SourceStatus[];
  listings: ClientListing[];
  clarify?: ClarifyingQuestion;
  error?: string;
  ms?: number;
}

type Action =
  | { type: 'start'; query: string }
  | { type: 'event'; event: SearchEvent }
  | { type: 'end' }
  | { type: 'fail'; message: string };

function reducer(state: SearchState, action: Action): SearchState {
  switch (action.type) {
    case 'start':
      return {
        phase: 'searching',
        query: action.query,
        sources: state.sources.map((source) =>
          source.state === 'skipped' ? source : { ...source, state: 'pending', count: undefined, ms: undefined, cached: undefined, detail: undefined },
        ),
        listings: [],
      };
    case 'event':
      return applyEvent(state, action.event);
    case 'end':
      // The stream closed without a `done` event: the connection dropped mid-search.
      return state.phase === 'searching'
        ? { ...state, phase: 'failed', error: 'The search stopped before it finished. Please try again.' }
        : state;
    case 'fail':
      return { ...state, phase: 'failed', error: action.message };
  }
}

function applyEvent(state: SearchState, event: SearchEvent): SearchState {
  switch (event.type) {
    case 'spec':
      return { ...state, spec: event.spec };
    case 'clarify':
      return { ...state, phase: 'done', clarify: event.question };
    case 'sources':
      return { ...state, sources: event.sources };
    case 'source':
      return { ...state, sources: state.sources.map((s) => (s.id === event.source.id ? event.source : s)) };
    case 'listings':
      return { ...state, listings: [...state.listings, ...event.listings] };
    case 'done':
      return { ...state, phase: 'done', ms: event.ms };
    case 'error':
      return { ...state, phase: 'failed', error: event.message };
  }
}

interface StreamRequest {
  query: string;
  postalCode: string;
  /** false: search as typed, even if the query is ambiguous. */
  clarify?: boolean;
}

async function streamSearch(
  { query, postalCode, clarify }: StreamRequest,
  signal: AbortSignal,
  dispatch: (action: Action) => void,
): Promise<void> {
  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, postalCode: postalCode.trim() || undefined, clarify }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Search failed (HTTP ${response.status}).`);
    }
    for await (const event of readEvents(response.body)) {
      if (signal.aborted) return; // A newer search replaced this one.
      dispatch({ type: 'event', event });
    }
    if (!signal.aborted) dispatch({ type: 'end' });
  } catch (err) {
    if (signal.aborted) return;
    const offline = err instanceof TypeError;
    dispatch({
      type: 'fail',
      message: offline
        ? "Couldn't reach DealHound. Check your connection and try again."
        : err instanceof Error
          ? err.message
          : 'Search failed.',
    });
  }
}

// The postal code is remembered per browser, as a convenience.
const POSTAL_CODE_KEY = 'dealhound:postal-code';

function readSavedPostalCode(): string | null {
  try {
    return localStorage.getItem(POSTAL_CODE_KEY);
  } catch {
    return null;
  }
}

function savePostalCode(value: string) {
  try {
    localStorage.setItem(POSTAL_CODE_KEY, value);
  } catch {
    // Storage blocked (private mode, disabled site data): nothing to remember it in.
  }
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export function SearchApp({ region, initialQuery, initialSources, defaultPostalCode }: SearchAppProps) {
  const [state, dispatch] = useReducer(
    reducer,
    null,
    (): SearchState => ({
      phase: initialQuery ? 'searching' : 'idle',
      query: initialQuery,
      sources: initialSources,
      listings: [],
    }),
  );
  const [query, setQuery] = useState(initialQuery);
  const savedPostalCode = useSyncExternalStore(subscribeToStorage, readSavedPostalCode, () => null);
  const [postalCodeDraft, setPostalCodeDraft] = useState<string | null>(null);
  const postalCode = postalCodeDraft ?? savedPostalCode ?? defaultPostalCode;

  const controllerRef = useRef<AbortController | null>(null);
  const startStream = useCallback((request: StreamRequest) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    void streamSearch(request, controller.signal, dispatch);
    return controller;
  }, []);

  // A search linked by URL runs on load; state already starts as 'searching'.
  useEffect(() => {
    if (!initialQuery) return;
    const controller = startStream({ query: initialQuery, postalCode: readSavedPostalCode() ?? defaultPostalCode });
    return () => controller.abort();
  }, [initialQuery, defaultPostalCode, startStream]);

  function search(rawQuery: string, { clarify }: { clarify?: boolean } = {}) {
    const searchQuery = rawQuery.replace(/\s+/g, ' ').trim();
    if (searchQuery.length < 2) return;
    setQuery(searchQuery);
    if (postalCodeDraft !== null) savePostalCode(postalCodeDraft);
    dispatch({ type: 'start', query: searchQuery });
    window.history.replaceState(null, '', `?q=${encodeURIComponent(searchQuery)}`);
    startStream({ query: searchQuery, postalCode, clarify });
  }

  const listings = useMemo(
    () => [...state.listings].sort((a, b) => landedPrice(a) - landedPrice(b)),
    [state.listings],
  );
  const sourceNames = useMemo(
    () => Object.fromEntries(state.sources.map((source) => [source.id, source.name])),
    [state.sources],
  );
  const searching = state.phase === 'searching';
  const demoActive = state.sources.some((source) => source.demo && source.state !== 'skipped');
  const sourcesWithResults = state.sources.filter((source) => (source.count ?? 0) > 0).length;

  return (
    <>
      <SearchForm
        region={region}
        query={query}
        postalCode={postalCode}
        busy={searching}
        onQueryChange={setQuery}
        onPostalCodeChange={setPostalCodeDraft}
        onSearch={search}
      />

      {demoActive && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-semibold">Demo data.</strong> These listings come from local fixtures, not live
          stores. Add API keys to <code className="font-mono">.env.local</code> to search real sources.
        </p>
      )}

      <SourceStatusList sources={state.sources} searching={searching} />

      {state.phase !== 'idle' && (
        <section aria-labelledby="results-heading" aria-busy={searching} className="mt-8">
          {state.phase === 'failed' && (
            <p
              role="alert"
              className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
            >
              {state.error}
            </p>
          )}

          {state.clarify ? (
            <ClarifyPrompt
              question={state.clarify}
              query={state.query}
              onPick={search}
              onSearchAsTyped={() => search(state.query, { clarify: false })}
            />
          ) : (
            (state.phase !== 'failed' || listings.length > 0) && (
              <>
                {state.spec && <SpecSummary spec={state.spec} />}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 id="results-heading" className="text-lg font-semibold">
                    {searching && listings.length === 0
                      ? state.spec
                        ? 'Searching…'
                        : 'Reading your search…'
                      : `${listings.length} listing${listings.length === 1 ? '' : 's'}`}
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Cheapest first (price + shipping)
                    {state.phase === 'done' && state.ms !== undefined && ` · ${formatDuration(state.ms)}`}
                  </p>
                </div>
                <p className="sr-only" aria-live="polite">
                  {state.phase === 'done'
                    ? `Found ${listings.length} listings from ${sourcesWithResults} sources.`
                    : ''}
                </p>

                <div className="mt-3">
                  {listings.length > 0 ? (
                    <ListingTable listings={listings} sourceNames={sourceNames} locale={region.locale} />
                  ) : searching ? (
                    <ResultsSkeleton />
                  ) : (
                    <EmptyResults query={state.query} demo={demoActive} />
                  )}
                </div>
              </>
            )
          )}
        </section>
      )}
    </>
  );
}

interface ClarifyPromptProps {
  question: ClarifyingQuestion;
  /** What the shopper typed. */
  query: string;
  onPick(query: string): void;
  onSearchAsTyped(): void;
}

function ClarifyPrompt({ question, query, onPick, onSearchAsTyped }: ClarifyPromptProps) {
  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900/60 dark:bg-sky-950/40">
      <h2 id="results-heading" className="font-semibold text-sky-950 dark:text-sky-100">
        {question.question}
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {question.options.map((option) => (
          <button
            key={option.query}
            type="button"
            onClick={() => onPick(option.query)}
            className="rounded-full border border-sky-300 bg-white px-3 py-1.5 text-sm font-medium text-sky-900 hover:border-sky-500 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100"
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onSearchAsTyped}
          className="px-2 py-1.5 text-sm text-sky-800 underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700 dark:text-sky-300 dark:decoration-sky-700"
        >
          Search “{query}” as typed
        </button>
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="h-20 animate-pulse rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        />
      ))}
    </div>
  );
}

function EmptyResults({ query, demo }: { query: string; demo: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
      <p className="font-medium">No listings found for “{query}”.</p>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {demo
          ? 'Demo data only covers the M4 MacBook Air and Sony WH-1000XM5. Try one of the examples above.'
          : 'Try fewer words, or a more common name for the product.'}
      </p>
    </div>
  );
}
