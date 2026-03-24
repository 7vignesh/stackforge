import { randomUUID } from "node:crypto";
import type { Blueprint, SSEEvent, AgentName } from "@stackforge/shared";
import { JOB_STATUS } from "@stackforge/shared";

export type StoredJob = {
  id: string;
  prompt: string;
  projectName: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  agentsCompleted: AgentName[];
  blueprint?: Blueprint;
  events: SSEEvent[];
};

const store = new Map<string, StoredJob>();

export function createJob(prompt: string, projectName: string): StoredJob {
  const now = new Date().toISOString();
  const job: StoredJob = {
    id: randomUUID(),
    prompt,
    projectName,
    status: JOB_STATUS.QUEUED,
    createdAt: now,
    updatedAt: now,
    agentsCompleted: [],
    events: [],
  };
  store.set(job.id, job);
  return job;
}

export function getJob(id: string): StoredJob | undefined {
  return store.get(id);
}

export function updateJob(
  id: string,
  patch: Partial<Omit<StoredJob, "id" | "createdAt" | "events">>,
): void {
  const existing = store.get(id);
  if (existing === undefined) return;
  store.set(id, { ...existing, ...patch, updatedAt: new Date().toISOString() });
}

export function appendEvent(jobId: string, event: SSEEvent): void {
  const job = store.get(jobId);
  if (job === undefined) return;
  job.events.push(event);
}
