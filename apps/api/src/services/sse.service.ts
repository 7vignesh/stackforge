import type { Response } from "express";
import type { SSEEvent } from "@stackforge/shared";

type SSEClient = Response;

const clients = new Map<string, Set<SSEClient>>();

function formatEvent(event: SSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function broadcast(jobId: string, event: SSEEvent): void {
  const group = clients.get(jobId);
  if (group === undefined || group.size === 0) return;
  const payload = formatEvent(event);
  for (const res of group) {
    res.write(payload);
  }
}

export function subscribe(jobId: string, res: SSEClient, pastEvents: SSEEvent[]): void {
  for (const event of pastEvents) {
    res.write(formatEvent(event));
  }
  let group = clients.get(jobId);
  if (group === undefined) {
    group = new Set();
    clients.set(jobId, group);
  }
  group.add(res);
}

export function unsubscribe(jobId: string, res: SSEClient): void {
  const group = clients.get(jobId);
  if (group === undefined) return;
  group.delete(res);
  if (group.size === 0) clients.delete(jobId);
}

export function closeJobClients(jobId: string): void {
  const group = clients.get(jobId);
  if (group === undefined) return;
  for (const res of group) {
    res.end();
  }
  clients.delete(jobId);
}
