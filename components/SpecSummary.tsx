import type { ProductSpec } from '@/lib/types';

const PARSED_BY: Record<ProductSpec['parsedBy'], string> = {
  llm: 'read by AI',
  rules: 'read by rules',
  passthrough: 'searched as typed',
};

// How an attribute reads as a chip; anything else shows its bare value.
const LABELS: Record<string, (value: string) => string> = {
  chip: (value) => `${value} chip`,
  ram: (value) => `${value} RAM`,
  storage: (value) => `${value} storage`,
};

/** "Looking for Apple MacBook Air [M4 chip] [16GB RAM]": what the search understood. */
export function SpecSummary({ spec }: { spec: ProductSpec }) {
  const product = spec.model ? [spec.brand, spec.model, spec.variant].filter(Boolean).join(' ') : spec.searchQuery;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">Looking for</span>
      <span className="font-semibold">{product}</span>
      {Object.entries(spec.required).map(([name, value]) => (
        <span
          key={name}
          className="rounded-md bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          {LABELS[name]?.(value) ?? value}
        </span>
      ))}
      {Object.entries(spec.optional).map(([name, value]) => (
        <span
          key={name}
          title="Preferred, not required"
          className="rounded-md border border-dashed border-zinc-300 px-2 py-0.5 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
        >
          {LABELS[name]?.(value) ?? value}
        </span>
      ))}
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        · {PARSED_BY[spec.parsedBy]}, searching stores for “{spec.searchQuery}”
      </span>
    </div>
  );
}
