import 'server-only';

import { REGIONS } from '@/lib/config';
import { demoMode, missingEnv } from '@/lib/env';
import { sourceStatus } from '@/lib/search';
import type { RegionCode, SourceAdapter, SourceStatus } from '@/lib/types';
import { bestbuy } from './bestbuy';
import { craigslist } from './craigslist';
import { demoAdapters } from './demo';
import { ebay } from './ebay';
import { facebookMarketplace } from './facebook-marketplace';
import { kijiji } from './kijiji';
import { serpapi } from './serpapi';

/** Every source DealHound knows about, in display order. Register new adapters here. */
export const adapters: SourceAdapter[] = [
  serpapi,
  ebay,
  bestbuy,
  facebookMarketplace,
  kijiji,
  craigslist,
  ...demoAdapters,
];

export interface SourcePlan {
  /** Adapters to query. */
  active: SourceAdapter[];
  /** One per adapter: `pending` if it will run, otherwise `skipped` with the reason. */
  statuses: SourceStatus[];
}

/** Decides which adapters run for a search in `region`, and why the rest don't. */
export function planSources(region: RegionCode, all: SourceAdapter[] = adapters): SourcePlan {
  const skipReasons = new Map<string, string>();
  for (const adapter of all) {
    if (adapter.regions && !adapter.regions.includes(region)) {
      skipReasons.set(adapter.id, `Not available in ${REGIONS[region].name}`);
    } else if (!adapter.enabled()) {
      skipReasons.set(adapter.id, adapter.disabledReason?.() ?? notConfigured(adapter));
    }
  }

  // In auto mode, demo data steps aside as soon as one real source can run.
  const realSourceAvailable = all.some((adapter) => !adapter.demo && !skipReasons.has(adapter.id));
  if (demoMode() === 'auto' && realSourceAvailable) {
    for (const adapter of all) {
      if (adapter.demo && !skipReasons.has(adapter.id)) {
        skipReasons.set(adapter.id, 'Demo data is off because real sources are configured');
      }
    }
  }

  return {
    active: all.filter((adapter) => !skipReasons.has(adapter.id)),
    statuses: all.map((adapter) => {
      const reason = skipReasons.get(adapter.id);
      return reason ? sourceStatus(adapter, 'skipped', { detail: reason }) : sourceStatus(adapter, 'pending');
    }),
  };
}

function notConfigured(adapter: SourceAdapter): string {
  const missing = missingEnv(adapter.requiredEnv ?? []);
  return missing.length > 0 ? `Not configured: set ${missing.join(', ')}` : 'Disabled';
}
