/** Small shared helpers. Kept dependency-free so any layer can use them. */

import { randomUUID } from "node:crypto";

/** ISO-8601 timestamp, always UTC. Used for every `created_at`/`updated_at`. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Prefixed identifier, e.g. `loop_1f9c…`. The prefix makes logs readable. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * Truncate captured command output, keeping the tail.
 *
 * The tail matters more than the head: compilers and test runners print the
 * summary last, and a 4000-line stack trace is mostly noise before the final
 * "3 failing". A marker is prepended so the reader knows text was dropped.
 */
export function truncateOutput(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }

  if (text.length <= maxChars) {
    return text;
  }

  const marker = `…[truncated ${text.length - maxChars} chars]\n`;
  return marker + text.slice(text.length - maxChars);
}

/** Normalize a tag: lowercase, trimmed, no empty strings, de-duplicated. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();

  for (const raw of tags) {
    const tag = raw.trim().toLowerCase();
    if (tag.length > 0) {
      seen.add(tag);
    }
  }

  return [...seen].sort();
}
