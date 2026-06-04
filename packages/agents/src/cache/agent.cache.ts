import { createHash } from "node:crypto";

type CacheEntry = {
  output: unknown;
  cachedAt: number;
};

type AgentCacheOptions = {
  maxEntries?: number;
  ttlMs?: number;
};

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class AgentCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options?: AgentCacheOptions) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }

    // Check TTL expiry
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }

    return entry;
  }

  set(key: string, output: unknown): void {
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    this.store.set(key, { output, cachedAt: Date.now() });
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return false;
    }

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
