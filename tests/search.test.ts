import { describe, expect, it, vi } from 'vitest';
import { sleep } from '@/lib/async';
import { MemoryCache } from '@/lib/cache';
import { describeError, fanOut, runSource, toClientListing } from '@/lib/search';
import { passthroughSpec } from '@/lib/spec';
import { fanOutOptions, makeAdapter, makeListing } from './helpers';

const spec = passthroughSpec('m4 macbook air 16gb');

describe('fanOut', () => {
  it('keeps the other sources when one throws', async () => {
    const outcomes = await fanOut(
      [
        makeAdapter('good', async () => [makeListing('good:1')]),
        makeAdapter('bad', async () => {
          throw new Error('HTTP 503');
        }),
      ],
      spec,
      fanOutOptions(),
    );

    expect(outcomes.map((o) => o.status.state)).toEqual(['ok', 'error']);
    expect(outcomes[0].listings).toHaveLength(1);
    expect(outcomes[1].status.detail).toBe('HTTP 503');
  });

  it('times out a slow source and aborts its signal', async () => {
    let aborted = false;
    const slow = makeAdapter(
      'slow',
      (_spec, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
    );

    const [outcome] = await fanOut([slow], spec, fanOutOptions({ timeoutMs: 20 }));

    expect(outcome.status.state).toBe('timeout');
    expect(aborted).toBe(true);
  });

  it('times out a source that ignores its abort signal', async () => {
    const stubborn = makeAdapter('stubborn', () => new Promise(() => {}));
    const [outcome] = await fanOut([stubborn], spec, fanOutOptions({ timeoutMs: 20 }));
    expect(outcome.status.state).toBe('timeout');
  });

  it('reports each source as soon as it finishes', async () => {
    const finished: string[] = [];
    await fanOut(
      [
        makeAdapter('slow', async () => {
          await sleep(40);
          return [];
        }),
        makeAdapter('fast', async () => []),
      ],
      spec,
      fanOutOptions(),
      (outcome) => finished.push(outcome.status.id),
    );
    expect(finished).toEqual(['fast', 'slow']);
  });

  it('survives a throwing outcome handler', async () => {
    const outcomes = await fanOut([makeAdapter('a', async () => [])], spec, fanOutOptions(), () => {
      throw new Error('stream closed');
    });
    expect(outcomes[0].status.state).toBe('ok');
  });
});

describe('runSource', () => {
  it('drops malformed listings and keeps the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = makeAdapter('mixed', async () => [
      makeListing('mixed:ok'),
      makeListing('mixed:nan', { price: Number.NaN }),
      makeListing('mixed:no-title', { title: '  ' }),
      makeListing('mixed:bad-url', { url: 'javascript:alert(1)' }),
    ]);

    const outcome = await runSource(adapter, spec, fanOutOptions());

    expect(outcome.status).toMatchObject({ state: 'ok', count: 1 });
    expect(outcome.listings.map((l) => l.id)).toEqual(['mixed:ok']);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('reports an adapter that returns something other than a list as an error', async () => {
    const adapter = makeAdapter('odd', async () => ({}) as never);
    const outcome = await runSource(adapter, spec, fanOutOptions());
    expect(outcome.status.state).toBe('error');
  });

  it('caps results at the limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) => makeListing(`many:${i}`));
    const outcome = await runSource(makeAdapter('many', async () => many), spec, fanOutOptions({ limit: 3 }));
    expect(outcome.listings).toHaveLength(3);
  });

  it('serves a repeat search from the cache', async () => {
    const search = vi.fn(async () => [makeListing('cached:1')]);
    const adapter = makeAdapter('cached', search);
    const opts = fanOutOptions({ cache: new MemoryCache() });

    await runSource(adapter, spec, opts);
    const second = await runSource(adapter, spec, opts);

    expect(search).toHaveBeenCalledTimes(1);
    expect(second.status).toMatchObject({ state: 'ok', cached: true, count: 1 });
  });

  it('does not cache failures', async () => {
    const search = vi.fn(async () => {
      throw new Error('flaky');
    });
    const adapter = makeAdapter('flaky', search);
    const opts = fanOutOptions({ cache: new MemoryCache() });

    await runSource(adapter, spec, opts);
    await runSource(adapter, spec, opts);

    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('describeError', () => {
  it('redacts keys and tokens from error text', () => {
    const message = describeError(
      new Error('GET https://serpapi.com/search.json?q=mac&api_key=sk_live_123 failed; Bearer abc.def'),
    );
    expect(message).not.toContain('sk_live_123');
    expect(message).not.toContain('abc.def');
    expect(message).toContain('api_key=***');
  });
});

describe('toClientListing', () => {
  it('strips the raw payload', () => {
    const client = toClientListing(makeListing('x:1', { raw: { secret: 'internal' } }));
    expect(client).not.toHaveProperty('raw');
    expect(client.id).toBe('x:1');
  });
});
