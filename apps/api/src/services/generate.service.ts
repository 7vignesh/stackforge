import type { SSEEvent, AgentName } from "@stackforge/shared";

import { JOB_STATUS } from "@stackforge/shared";
import {
  OpenRouterProvider,
  MockProvider,
  AgentCache,
  runOrchestrator,
  type LLMProvider,
} from "@stackforge/agents";
import {
  createJob,
  getJob,
  updateJob,
  appendEvent,
  type StoredJob,
} from "../store/job.store.js";
import { broadcast, closeJobClients } from "./sse.service.js";
import {
  finalizeRun,
  getTelemetry,
  initRun,
  recordAgentComplete,
  recordAgentTokens,
} from "./telemetry.js";

type ProviderMode = "openrouter" | "mock";

export type RuntimeStatus = {
  provider: ProviderMode;
  ready: boolean;
  reason?: string;
};

function resolveProviderMode(): ProviderMode {
  const configured = (process.env["STACKFORGE_PROVIDER"] ?? "auto").trim().toLowerCase();

  if (configured === "openrouter") {
    return "openrouter";
  }

  if (configured === "mock") {
    return "mock";
  }

  const hasOpenRouterKey = (process.env["OPENROUTER_API_KEY"] ?? "").trim().length > 0;
  return hasOpenRouterKey ? "openrouter" : "mock";
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildOpenRouterProvider(): OpenRouterProvider {
  const endpoint = process.env["OPENROUTER_ENDPOINT"];
  const options = {
    apiKey: readEnv("OPENROUTER_API_KEY"),
    appName: process.env["OPENROUTER_APP_NAME"] ?? "stackforge-api",
    appUrl: process.env["OPENROUTER_APP_URL"] ?? "http://localhost",
    ...(endpoint !== undefined && endpoint.trim().length > 0 ? { endpoint } : {}),
  };

  return new OpenRouterProvider(options);
}

function buildProvider(mode: ProviderMode): LLMProvider {
  if (mode === "mock") {
    return new MockProvider();
  }

  return buildOpenRouterProvider();
}

let provider: LLMProvider | undefined;
let providerMode: ProviderMode | undefined;

function getProvider(): LLMProvider {
  if (provider === undefined) {
    providerMode = resolveProviderMode();
    provider = buildProvider(providerMode);
  }

  return provider;
}

export function getProviderForPipeline(): LLMProvider {
  return getProvider();
}

export function getRuntimeStatus(): RuntimeStatus {
  const mode = providerMode ?? resolveProviderMode();

  try {
    void getProvider();
    return { provider: mode, ready: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { provider: mode, ready: false, reason };
  }
}

const cache = new AgentCache();

function inferProviderFromModel(model: string): "gemini" | "groq" {
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "gemini";
  }

  return "groq";
}

function buildTelemetryEvent(jobId: string): SSEEvent | undefined {
  const telemetry = getTelemetry(jobId);
  if (telemetry === undefined) {
    return undefined;
  }

  return {
    type: "telemetry_update",
    jobId,
    timestamp: new Date().toISOString(),
    data: telemetry,
  };
}

function buildEmitter(jobId: string): (event: SSEEvent) => void {
  return (event: SSEEvent): void => {
    appendEvent(jobId, event);

    if (event.type === "job_created") {
      initRun(jobId);
    }

    if (event.type === "agent_completed") {
      const job = getJob(jobId);
      if (job !== undefined && !job.agentsCompleted.includes(event.agent as AgentName)) {
        updateJob(jobId, { agentsCompleted: [...job.agentsCompleted, event.agent as AgentName] });

      }

      const provider = inferProviderFromModel(event.payload.model);
      recordAgentTokens(jobId, event.agent, provider, event.payload.totalTokens);
      recordAgentComplete(jobId, event.agent);
    }

    if (event.type === "job_completed" || event.type === "job_failed") {
      finalizeRun(jobId);
    }

    broadcast(jobId, event);

    const telemetryEvent = buildTelemetryEvent(jobId);
    if (telemetryEvent !== undefined) {
      appendEvent(jobId, telemetryEvent);
      broadcast(jobId, telemetryEvent);
    }
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

    const blueprint = await runOrchestrator({
      jobId,
      prompt,
      projectName,
      emit,
      provider: getProvider(),
      cache,
    });

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
