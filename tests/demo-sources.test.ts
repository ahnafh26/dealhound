import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSource } from '@/lib/search';
import { createDemoAdapter, DEMO_SOURCES, parseDemoFixture, relevance } from '@/lib/sources/demo';
import { planSources } from '@/lib/sources';
import { passthroughSpec } from '@/lib/spec';
import type { SourceAdapter } from '@/lib/types';
import { fanOutOptions, makeAdapter } from './helpers';

const instant = DEMO_SOURCES.map((def) => createDemoAdapter({ ...def, latencyMs: 0 }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('demo fixtures', () => {
  it.each(DEMO_SOURCES.map((def) => [def.id, def] as const))('%s fixture is valid with unique ids', (_id, def) => {
    const items = parseDemoFixture(def.fixture);
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});

describe('demo adapters', () => {
  it('find the example product in every source, noise included', async () => {
    const spec = passthroughSpec('M4 MacBook Air 16GB');
    for (const adapter of instant) {
      const outcome = await runSource(adapter, spec, fanOutOptions());
      expect(outcome.status.state, adapter.id).toBe('ok');
      expect(outcome.listings.length, adapter.id).toBeGreaterThan(0);
      expect(outcome.listings.every((l) => /macbook/i.test(l.title)), adapter.id).toBe(true);
    }
  });

  it('return nothing for products outside the fixtures', async () => {
    const outcome = await runSource(instant[0], passthroughSpec('Nintendo Switch 2'), fanOutOptions());
    expect(outcome.listings).toEqual([]);
  });

  it('stamp each listing with its source', async () => {
    const outcome = await runSource(instant[0], passthroughSpec('Sony WH-1000XM5'), fanOutOptions());
    for (const listing of outcome.listings) {
      expect(listing.id.startsWith('demo-retail:')).toBe(true);
      expect(listing).toMatchObject({ source: 'demo-retail', sourceType: 'retail' });
    }
  });

  it('let a fixture override the channel', async () => {
    const outcome = await runSource(instant[0], passthroughSpec('M4 MacBook Air 16GB'), fanOutOptions());
    const thirdParty = outcome.listings.find((l) => l.id.endsWith('third-party'));
    expect(thirdParty?.channel).toBe('protected-marketplace');
  });

  it('fail on demand via DEMO_SIMULATE_FAILURES', async () => {
    vi.stubEnv('DEMO_SIMULATE_FAILURES', 'demo-retail:error, demo-refurb:timeout');
    const spec = passthroughSpec('Sony WH-1000XM5');
    const [retail, refurb, marketplace] = await Promise.all(
      instant.slice(0, 3).map((adapter) => runSource(adapter, spec, fanOutOptions({ timeoutMs: 50 }))),
    );
    expect(retail.status.state).toBe('error');
    expect(refurb.status.state).toBe('timeout');
    expect(marketplace.status.state).toBe('ok');
  });
});

describe('relevance', () => {
  it('scores the share of query words found in the title', () => {
    expect(relevance('M4 MacBook Air 16GB', 'Apple MacBook Air 13-inch (M4) 16 GB')).toBe(1);
    expect(relevance('Sony XM5', 'Sony WH-1000XM5 Headphones')).toBe(1);
    expect(relevance('Sony WH-1000XM5', 'Nintendo Switch')).toBe(0);
  });
});

describe('planSources', () => {
  const real: SourceAdapter = makeAdapter('real', async () => []);
  const caOnly: SourceAdapter = { ...makeAdapter('ca-only', async () => []), regions: ['CA'] };
  const needsKey: SourceAdapter = {
    ...makeAdapter('needs-key', async () => []),
    requiredEnv: ['SOME_API_KEY'],
    enabled: () => false,
  };

  it('uses demo sources while no real source is configured', () => {
    const plan = planSources('CA', [needsKey, ...instant]);
    expect(plan.active.map((a) => a.id)).toEqual(DEMO_SOURCES.map((d) => d.id));
    expect(plan.statuses[0]).toMatchObject({ state: 'skipped', detail: 'Not configured: set SOME_API_KEY' });
  });

  it('turns demo sources off once a real source can run', () => {
    const plan = planSources('CA', [real, ...instant]);
    expect(plan.active.map((a) => a.id)).toEqual(['real']);
  });

  it('keeps demo sources alongside real ones with DEMO_MODE=on', () => {
    vi.stubEnv('DEMO_MODE', 'on');
    expect(planSources('CA', [real, ...instant]).active).toHaveLength(1 + instant.length);
  });

  it('skips sources outside the region', () => {
    const plan = planSources('US', [caOnly]);
    expect(plan.statuses[0]).toMatchObject({ state: 'skipped', detail: 'Not available in United States' });
  });
});
