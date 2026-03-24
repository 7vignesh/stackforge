import { createHash } from "node:crypto";

type CacheEntry = {
  output: unknown;
  cachedAt: number;
};

export class AgentCache {
  private readonly store = new Map<string, CacheEntry>();

  hash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  get(key: string): CacheEntry | undefined {
    return this.store.get(key);
  }

  set(key: string, output: unknown): void {
    this.store.set(key, { output, cachedAt: Date.now() });
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
