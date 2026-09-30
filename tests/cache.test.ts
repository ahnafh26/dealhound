import { describe, expect, it } from 'vitest';
import { MemoryCache } from '@/lib/cache';

describe('MemoryCache', () => {
  it('returns a value until its TTL runs out', async () => {
    let now = 1_000;
    const cache = new MemoryCache(10, () => now);
    await cache.set('key', { n: 1 }, 500);

    now += 499;
    expect(await cache.get('key')).toEqual({ n: 1 });
    now += 1;
    expect(await cache.get('key')).toBeUndefined();
  });

  it('evicts the least recently used entry when full', async () => {
    const cache = new MemoryCache(2);
    await cache.set('a', 1, 60_000);
    await cache.set('b', 2, 60_000);
    await cache.get('a'); // `a` is now the most recently used.
    await cache.set('c', 3, 60_000);

    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBe(1);
    expect(await cache.get('c')).toBe(3);
  });

  it('overwrites and deletes', async () => {
    const cache = new MemoryCache();
    await cache.set('k', 'old', 60_000);
    await cache.set('k', 'new', 60_000);
    expect(await cache.get('k')).toBe('new');
    await cache.delete('k');
    expect(await cache.get('k')).toBeUndefined();
  });
});
