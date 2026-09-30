import { CACHE } from './config';

/**
 * Async so the in-memory LRU can be swapped for Redis (e.g. Upstash) without
 * touching callers: implement this interface and return it from getCache().
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * In-process LRU with a TTL per entry. Lives as long as the server process,
 * so on serverless hosts each instance has its own — fine for a cache.
 */
export class MemoryCache implements Cache {
  // Map iterates in insertion order, so the first key is the least recently used.
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(maxEntries = CACHE.maxEntries, now: () => number = Date.now) {
    this.maxEntries = maxEntries;
    this.now = now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

// Kept on globalThis so dev-mode hot reloads don't throw the cache away.
const globalForCache = globalThis as typeof globalThis & { __dealhoundCache?: Cache };

export function getCache(): Cache {
  globalForCache.__dealhoundCache ??= new MemoryCache();
  return globalForCache.__dealhoundCache;
}
