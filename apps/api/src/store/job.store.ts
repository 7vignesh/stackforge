import { randomUUID } from "node:crypto";
import type {
  Blueprint,
  SSEEvent,
  AgentName,
  AgentCompletedEvent,
} from "@stackforge/shared";
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

/**
 * Memory-bounded job store with TTL eviction.
 *
 * - MAX_JOBS: Maximum number of jobs to retain in memory.
 * - JOB_TTL_MS: Time-to-live for completed/failed jobs (default 1 hour).
 * - EVICTION_INTERVAL_MS: How often to run the eviction sweep (default 5 minutes).
 */
const MAX_JOBS = 200;
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour
const EVICTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const store = new Map<string, StoredJob>();

// Periodic eviction of expired completed/failed jobs
setInterval(() => {
  evictExpiredJobs();
}, EVICTION_INTERVAL_MS).unref();

function evictExpiredJobs(): void {
  const now = Date.now();
  const toDelete: string[] = [];

  for (const [id, job] of store) {
    // Only evict completed or failed jobs
    if (job.status !== "completed" && job.status !== "failed") {
      continue;
    }

    const completedTime = job.completedAt ? new Date(job.completedAt).getTime() : 0;
    const updatedTime = new Date(job.updatedAt).getTime();
    const referenceTime = Math.max(completedTime, updatedTime);

    if (now - referenceTime > JOB_TTL_MS) {
      toDelete.push(id);
    }
  }

  for (const id of toDelete) {
    store.delete(id);
  }

  if (toDelete.length > 0) {
    console.log(`[job-store] Evicted ${toDelete.length} expired jobs. Current size: ${store.size}`);
  }
}

function evictOldestIfAtCapacity(): void {
  if (store.size < MAX_JOBS) {
    return;
  }

  // Find the oldest completed/failed job to evict
  let oldestId: string | undefined;
  let oldestTime = Infinity;

  for (const [id, job] of store) {
    if (job.status !== "completed" && job.status !== "failed") {
      continue;
    }

    const createdTime = new Date(job.createdAt).getTime();
    if (createdTime < oldestTime) {
      oldestTime = createdTime;
      oldestId = id;
    }
  }

  if (oldestId !== undefined) {
    store.delete(oldestId);
    return;
  }

  // If all jobs are still running/queued, evict the oldest regardless
  let fallbackId: string | undefined;
  let fallbackTime = Infinity;

  for (const [id, job] of store) {
    const createdTime = new Date(job.createdAt).getTime();
    if (createdTime < fallbackTime) {
      fallbackTime = createdTime;
      fallbackId = id;
    }
  }

  if (fallbackId !== undefined) {
    store.delete(fallbackId);
  }
}

export type JobTokenUsage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  completionEvents: number;
  byAgent: Partial<Record<AgentName, {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    count: number;
  }>>;
};

function isAgentCompletedEvent(event: SSEEvent): event is AgentCompletedEvent {
  return event.type === "agent_completed";
}

export function summarizeJobTokenUsage(job: StoredJob): JobTokenUsage {
  const initial: JobTokenUsage = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    completionEvents: 0,
    byAgent: {},
  };

  for (const event of job.events) {
    if (!isAgentCompletedEvent(event)) {
      continue;
    }

    initial.totalTokens += event.payload.totalTokens;
    initial.inputTokens += event.payload.inputTokens;
    initial.outputTokens += event.payload.outputTokens;
    initial.completionEvents += 1;

    const agent = event.agent as AgentName;

    const existing = initial.byAgent[agent] ?? {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      count: 0,
    };

    initial.byAgent[agent] = {
      totalTokens: existing.totalTokens + event.payload.totalTokens,
      inputTokens: existing.inputTokens + event.payload.inputTokens,
      outputTokens: existing.outputTokens + event.payload.outputTokens,
      count: existing.count + 1,
    };
  }

  return initial;
}

export function createJob(prompt: string, projectName: string): StoredJob {
  evictOldestIfAtCapacity();

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

export function listJobs(): StoredJob[] {
  return [...store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
