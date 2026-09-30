import { Logo } from '@/components/Logo';
import { SearchApp } from '@/components/SearchApp';
import { REGIONS, SEARCH } from '@/lib/config';
import { defaultPostalCode, defaultRegion } from '@/lib/env';
import { planSources } from '@/lib/sources';

export default async function Home({ searchParams }: PageProps<'/'>) {
  const { q } = await searchParams;
  const region = REGIONS[defaultRegion()];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
      <header className="mb-6 sm:mb-8">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-xl font-semibold tracking-tight">DealHound</span>
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          Find the best real deal: new, refurbished, or used.
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          One search across stores, refurbishers, and marketplaces.
        </p>
      </header>

      <SearchApp
        region={region}
        initialQuery={typeof q === 'string' ? q.slice(0, SEARCH.queryMaxLength) : ''}
        initialSources={planSources(region.code).statuses}
        defaultPostalCode={defaultPostalCode() ?? ''}
      />
    </main>
  );
}
