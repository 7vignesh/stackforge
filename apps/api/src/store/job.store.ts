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

const store = new Map<string, StoredJob>();

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
