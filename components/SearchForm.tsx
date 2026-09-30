'use client';

import type { RegionConfig } from '@/lib/config';
import { resolveRegion, taxRateFor } from '@/lib/region';

const EXAMPLES = ['M4 MacBook Air 16GB', 'Sony WH-1000XM5'];

interface SearchFormProps {
  region: RegionConfig;
  query: string;
  postalCode: string;
  busy: boolean;
  onQueryChange(value: string): void;
  onPostalCodeChange(value: string): void;
  onSearch(query: string): void;
}

export function SearchForm({
  region,
  query,
  postalCode,
  busy,
  onQueryChange,
  onPostalCodeChange,
  onSearch,
}: SearchFormProps) {
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(query);
      }}
      className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="query" className="sr-only">
          What are you shopping for?
        </label>
        <input
          id="query"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="e.g. M4 MacBook Air 16GB"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={200}
          className="h-12 min-w-0 rounded-xl border border-zinc-300 bg-white px-4 text-base outline-none placeholder:text-zinc-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 sm:flex-1 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="flex gap-3">
          <label htmlFor="postal-code" className="sr-only">
            {region.postalCodeLabel}
          </label>
          <input
            id="postal-code"
            value={postalCode}
            onChange={(event) => onPostalCodeChange(event.target.value)}
            placeholder={region.postalCodePlaceholder}
            autoComplete="postal-code"
            maxLength={10}
            className="h-12 w-full min-w-0 rounded-xl border border-zinc-300 bg-white px-4 text-base uppercase outline-none placeholder:normal-case placeholder:text-zinc-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 sm:w-32 dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled={query.trim().length < 2}
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-5 font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            Search
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 px-1 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between dark:text-zinc-400">
        <p>{taxHint(region, postalCode)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span>Try</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                onQueryChange(example);
                onSearch(example);
              }}
              className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-zinc-700 transition-colors hover:border-emerald-600 hover:text-emerald-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:text-emerald-400"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

function taxHint(region: RegionConfig, postalCode: string): string {
  const resolved = resolveRegion(region.code, postalCode);
  const tax = taxRateFor(resolved);
  const rate = `${tax.name} · ${tax.label}`;
  if (region.code !== 'CA' || resolved.subdivisionSource === 'postal-code') return `Tax: ${rate}`;
  if (postalCode.trim()) return `${region.postalCodeLabel} not recognized, so using ${rate}`;
  return `Tax: ${rate}. Add your ${region.postalCodeLabel.toLowerCase()} for your province's rate.`;
}
