import { formatDuration } from '@/lib/format';
import type { SourceStatus } from '@/lib/types';

export function SourceStatusList({ sources, searching }: { sources: SourceStatus[]; searching: boolean }) {
  const active = sources.filter((source) => source.state !== 'skipped');
  const skipped = sources.filter((source) => source.state === 'skipped');

  return (
    <section aria-labelledby="sources-heading" className="mt-6">
      <h2
        id="sources-heading"
        className="text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400"
      >
        Sources
      </h2>
      {active.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {active.map((source) => (
            <SourcePill key={source.id} source={source} searching={searching} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          No sources are enabled. Add API keys to <code className="font-mono">.env.local</code>, or set{' '}
          <code className="font-mono">DEMO_MODE=on</code> to use demo data.
        </p>
      )}
      {skipped.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-zinc-500 select-none hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            {skipped.length} not searched
          </summary>
          <ul className="mt-2 space-y-1.5 border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
            {skipped.map((source) => (
              <li key={source.id}>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{source.name}</span>
                <span className="text-zinc-500 dark:text-zinc-400">: {source.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const TONES = {
  neutral: 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  bad: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
};

function SourcePill({ source, searching }: { source: SourceStatus; searching: boolean }) {
  const { tone, label } = describe(source, searching);
  return (
    <li
      title={source.detail}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${TONES[tone]}`}
    >
      <StateIcon source={source} searching={searching} />
      <span className="font-medium whitespace-nowrap">{source.name}</span>
      <span className="truncate opacity-80">{label}</span>
    </li>
  );
}

function describe(source: SourceStatus, searching: boolean): { tone: keyof typeof TONES; label: string } {
  switch (source.state) {
    case 'pending':
      return { tone: 'neutral', label: searching ? 'searching…' : 'ready' };
    case 'ok': {
      const parts = [`${source.count ?? 0} found`];
      if (source.ms !== undefined) parts.push(formatDuration(source.ms));
      if (source.cached) parts.push('cached');
      return { tone: 'ok', label: parts.join(' · ') };
    }
    case 'timeout':
      return { tone: 'warn', label: 'timed out' };
    case 'error':
      return { tone: 'bad', label: source.detail ? `failed: ${source.detail}` : 'failed' };
    case 'skipped':
      return { tone: 'neutral', label: 'skipped' };
  }
}

function StateIcon({ source, searching }: { source: SourceStatus; searching: boolean }) {
  const common = 'size-3.5 shrink-0';
  switch (source.state) {
    case 'pending':
      return searching ? (
        <span aria-hidden="true" className={`${common} animate-spin rounded-full border-2 border-current border-t-transparent opacity-60`} />
      ) : (
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-emerald-500" />
      );
    case 'ok':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common}>
          <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'timeout':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
    case 'error':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true" className={common}>
          <path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case 'skipped':
      return null;
  }
}
