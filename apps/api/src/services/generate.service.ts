import type { SSEEvent, AgentName } from "@stackforge/shared";

import { JOB_STATUS } from "@stackforge/shared";
import { MockProvider, AgentCache, runOrchestrator } from "@stackforge/agents";
import {
  createJob,
  getJob,
  updateJob,
  appendEvent,
  type StoredJob,
} from "../store/job.store.js";
import { broadcast, closeJobClients } from "./sse.service.js";

const provider = new MockProvider();
const cache = new AgentCache();

function buildEmitter(jobId: string): (event: SSEEvent) => void {
  return (event: SSEEvent): void => {
    appendEvent(jobId, event);

    if (event.type === "agent_completed") {
      const job = getJob(jobId);
      if (job !== undefined && !job.agentsCompleted.includes(event.agent as AgentName)) {
        updateJob(jobId, { agentsCompleted: [...job.agentsCompleted, event.agent as AgentName] });

      }
    }

    broadcast(jobId, event);
  };
}

async function startOrchestration(
  jobId: string,
  prompt: string,
  projectName: string,
): Promise<void> {
  const emit = buildEmitter(jobId);
  const jobStart = Date.now();

  try {
    updateJob(jobId, { status: JOB_STATUS.RUNNING });

    const blueprint = await runOrchestrator({ jobId, prompt, projectName, emit, provider, cache });

    const now = new Date().toISOString();
    updateJob(jobId, { status: JOB_STATUS.COMPLETED, blueprint, completedAt: now });

    emit({
      type: "job_completed",
      jobId,
      timestamp: now,
      payload: { durationMs: Date.now() - jobStart },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const now = new Date().toISOString();
    updateJob(jobId, { status: JOB_STATUS.FAILED, error, completedAt: now });

    emit({
      type: "job_failed",
      jobId,
      timestamp: now,
      payload: { error },
    });
  } finally {
    closeJobClients(jobId);
  }
}

export function generateProject(prompt: string, projectName: string): StoredJob {
  const job = createJob(prompt, projectName);
  const emit = buildEmitter(job.id);

  emit({
    type: "job_created",
    jobId: job.id,
    timestamp: job.createdAt,
    payload: { prompt, projectName: job.projectName },
  });

  void startOrchestration(job.id, prompt, job.projectName);

  return job;
}
