import 'server-only';

import { z } from 'zod';
import local from '@/fixtures/demo/local.json';
import marketplace from '@/fixtures/demo/marketplace.json';
import refurb from '@/fixtures/demo/refurb.json';
import retail from '@/fixtures/demo/retail.json';
import { sleep } from '@/lib/async';
import { demoMode, simulatedFailure } from '@/lib/env';
import { ChannelSchema, ListingSchema } from '@/lib/schemas';
import type { Channel, Listing, SourceAdapter, SourceType } from '@/lib/types';
import { relevance } from './parse';

/**
 * Fixture-backed stand-ins for real sources, so the app runs with zero API
 * keys. Each behaves like a real source: it takes a moment to answer, matches
 * the query loosely the way a search engine does (noise included), and can be
 * made to fail with DEMO_SIMULATE_FAILURES.
 */

const DemoItemSchema = ListingSchema.omit({ source: true, sourceType: true, channel: true }).extend({
  /** Overrides the source's channel, e.g. a third-party seller on a retailer's site. */
  channel: ChannelSchema.optional(),
});
type DemoItem = z.infer<typeof DemoItemSchema>;

export interface DemoSourceDef {
  id: string;
  name: string;
  type: SourceType;
  channel: Channel;
  latencyMs: number;
  fixture: unknown;
}

export const DEMO_SOURCES: DemoSourceDef[] = [
  {
    id: 'demo-retail',
    name: 'Demo · Retail stores',
    type: 'retail',
    channel: 'retailer',
    latencyMs: 400,
    fixture: retail,
  },
  {
    id: 'demo-refurb',
    name: 'Demo · Certified refurb',
    type: 'refurb',
    channel: 'certified-refurb',
    latencyMs: 700,
    fixture: refurb,
  },
  {
    id: 'demo-marketplace',
    name: 'Demo · Online marketplace',
    type: 'marketplace',
    channel: 'protected-marketplace',
    latencyMs: 1100,
    fixture: marketplace,
  },
  {
    id: 'demo-local',
    name: 'Demo · Local classifieds',
    type: 'marketplace',
    channel: 'local-marketplace',
    latencyMs: 1500,
    fixture: local,
  },
];

/** A listing is returned when at least this share of the query's words appear in its title. */
const MIN_RELEVANCE = 0.5;

export function parseDemoFixture(fixture: unknown): DemoItem[] {
  return z.array(DemoItemSchema).parse(fixture);
}

export function createDemoAdapter(def: DemoSourceDef): SourceAdapter {
  let items: DemoItem[] | undefined;
  return {
    id: def.id,
    name: def.name,
    type: def.type,
    demo: true,
    enabled: () => demoMode() !== 'off',
    disabledReason: () => 'Demo data is off (DEMO_MODE=off)',
    async search(spec, { signal, limit }) {
      await sleep(jitter(def.latencyMs), signal);
      const failure = simulatedFailure(def.id);
      if (failure === 'error') throw new Error('Simulated failure (DEMO_SIMULATE_FAILURES)');
      if (failure === 'timeout') await sleep(10 * 60_000, signal);

      items ??= parseDemoFixture(def.fixture);
      return items
        .filter((item) => relevance(spec.searchQuery, item.title) >= MIN_RELEVANCE)
        .slice(0, limit)
        .map(
          (item): Listing => ({
            ...item,
            id: `${def.id}:${item.id}`,
            source: def.id,
            sourceType: def.type,
            channel: item.channel ?? def.channel,
            raw: item,
          }),
        );
    },
  };
}

export const demoAdapters: SourceAdapter[] = DEMO_SOURCES.map(createDemoAdapter);

function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}
