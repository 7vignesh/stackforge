import type { Response } from "express";
import type { SSEEvent } from "@stackforge/shared";

type SSEClient = Response;

/**
 * Maximum concurrent SSE connections per job.
 * Prevents a single job from consuming too many server resources.
 */
const MAX_CLIENTS_PER_JOB = 20;

/**
 * Maximum total SSE connections across all jobs.
 */
const MAX_TOTAL_CLIENTS = 200;

/**
 * SSE connection timeout — auto-disconnect after 30 minutes of inactivity.
 */
const CONNECTION_TIMEOUT_MS = 30 * 60 * 1000;

type ClientEntry = {
  res: SSEClient;
  connectedAt: number;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const clients = new Map<string, Map<SSEClient, ClientEntry>>();

function getTotalClientCount(): number {
  let count = 0;
  for (const group of clients.values()) {
    count += group.size;
  }
  return count;
}

function formatEvent(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function cleanupClient(jobId: string, entry: ClientEntry): void {
  clearTimeout(entry.timeoutHandle);
  const group = clients.get(jobId);
  if (group === undefined) return;
  group.delete(entry.res);
  if (group.size === 0) clients.delete(jobId);

  // Safely end the response if it's still writable
  if (!entry.res.writableEnded) {
    entry.res.end();
  }
}

export function broadcast(jobId: string, event: SSEEvent): void {
  const group = clients.get(jobId);
  if (group === undefined || group.size === 0) return;
  const payload = formatEvent(event);

  for (const [, entry] of group) {
    try {
      if (!entry.res.writableEnded) {
        entry.res.write(payload);
      }
    } catch {
      // Client disconnected, will be cleaned up on next unsubscribe or timeout
    }
  }
}

export type SubscribeResult = {
  success: boolean;
  reason?: string;
};

export function subscribe(jobId: string, res: SSEClient, pastEvents: SSEEvent[]): SubscribeResult {
  // Check total connection limit
  if (getTotalClientCount() >= MAX_TOTAL_CLIENTS) {
    return { success: false, reason: "Server has reached maximum SSE connection capacity." };
  }

  // Check per-job connection limit
  let group = clients.get(jobId);
  if (group !== undefined && group.size >= MAX_CLIENTS_PER_JOB) {
    return { success: false, reason: "Maximum connections for this job reached." };
  }

  // Replay past events
  for (const event of pastEvents) {
    res.write(formatEvent(event));
  }

  if (group === undefined) {
    group = new Map();
    clients.set(jobId, group);
  }

  // Set up connection timeout
  const timeoutHandle = setTimeout(() => {
    const entry = group!.get(res);
    if (entry) {
      cleanupClient(jobId, entry);
    }
  }, CONNECTION_TIMEOUT_MS);

  // Prevent timer from keeping the process alive
  if (timeoutHandle.unref) {
    timeoutHandle.unref();
  }

  const entry: ClientEntry = {
    res,
    connectedAt: Date.now(),
    timeoutHandle,
  };

  group.set(res, entry);
  return { success: true };
}

export function unsubscribe(jobId: string, res: SSEClient): void {
  const group = clients.get(jobId);
  if (group === undefined) return;

  const entry = group.get(res);
  if (entry) {
    clearTimeout(entry.timeoutHandle);
    group.delete(res);
  } else {
    // Fallback: remove by reference
    group.delete(res);
  }

  if (group.size === 0) clients.delete(jobId);
}

export function closeJobClients(jobId: string): void {
  const group = clients.get(jobId);
  if (group === undefined) return;

  for (const [, entry] of group) {
    clearTimeout(entry.timeoutHandle);
    if (!entry.res.writableEnded) {
      entry.res.end();
    }
  }

  clients.delete(jobId);
}

/**
 * Get current SSE connection stats (useful for monitoring).
 */
export function getSSEStats(): { totalConnections: number; jobsWithClients: number } {
  return {
    totalConnections: getTotalClientCount(),
    jobsWithClients: clients.size,
  };
}
