import type { SSEEvent, AgentName, GenerateExecution } from "@stackforge/shared";

import { JOB_STATUS } from "@stackforge/shared";
import {
  OpenRouterProvider,
  NvidiaProvider,
  MockProvider,
  AgentCache,
  runOrchestrator,
  AGENT_CONFIGS,
  selectWorkflow,
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
  recordProviderCall,
  recordAgentTokens,
} from "./telemetry.js";

type ProviderMode = "openrouter" | "mock";
type CodegenProviderMode = "default" | "nvidia";

export type RuntimeStatus = {
  provider: ProviderMode;
  ready: boolean;
  reason?: string;
};

export type GenerateProjectOptions = {
  execution?: GenerateExecution;
};

class AgentRoutingProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly defaultProvider: LLMProvider,
    private readonly codegenProvider: LLMProvider,
  ) {
    this.name = `${defaultProvider.name}+${codegenProvider.name}`;
  }

  call(input: Parameters<LLMProvider["call"]>[0]): ReturnType<LLMProvider["call"]> {
    if (input.agentName === "codegen") {
      return this.codegenProvider.call(input);
    }

    return this.defaultProvider.call(input);
  }
}

function resolveProviderMode(): ProviderMode {
  const configured = (process.env["STACKFORGE_PROVIDER"] ?? "auto").trim().toLowerCase();

  if (configured === "openrouter") {
    return "openrouter";
  }

  if (configured === "mock") {
    return "mock";
  }

  const hasOpenRouterKey = [
    process.env["OPENROUTER_API_KEY"],
    process.env["OPENROUTER_API_KEY_1"],
    process.env["OPENROUTER_API_KEY_2"],
    process.env["OPENROUTER_API_KEY_3"],
  ].some((value) => (value ?? "").trim().length > 0);

  return hasOpenRouterKey ? "openrouter" : "mock";
}

function resolveCodegenProviderMode(): CodegenProviderMode {
  const configured = (process.env["STACKFORGE_CODEGEN_PROVIDER"] ?? "default").trim().toLowerCase();
  if (configured === "nvidia") {
    return "nvidia";
  }

  return "default";
}

function readOpenRouterApiKeys(): string[] {
  const key1 = (process.env["OPENROUTER_API_KEY_1"] ?? "").trim();
  const key2 = (process.env["OPENROUTER_API_KEY_2"] ?? "").trim();
  const key3 = (process.env["OPENROUTER_API_KEY_3"] ?? "").trim();

  const keyedValues = [key1, key2, key3].filter((value) => value.length > 0);
  if (keyedValues.length > 0 && keyedValues.length < 3) {
    throw new Error("Set all OPENROUTER_API_KEY_1, OPENROUTER_API_KEY_2, and OPENROUTER_API_KEY_3 for key rotation");
  }

  if (keyedValues.length === 3) {
    return [key1, key2, key3];
  }

  const legacy = (process.env["OPENROUTER_API_KEY"] ?? "").trim();
  if (legacy.length > 0) {
    return [legacy];
  }

  throw new Error("Missing required OpenRouter API key configuration");
}

function readNvidiaApiKeys(): string[] {
  const key1 = (process.env["NVIDIA_API_KEY_1"] ?? "").trim();
  const key2 = (process.env["NVIDIA_API_KEY_2"] ?? "").trim();
  const key3 = (process.env["NVIDIA_API_KEY_3"] ?? "").trim();

  const keyedValues = [key1, key2, key3].filter((value) => value.length > 0);
  if (keyedValues.length > 0 && keyedValues.length < 3) {
    throw new Error("Set all NVIDIA_API_KEY_1, NVIDIA_API_KEY_2, and NVIDIA_API_KEY_3 for key rotation");
  }

  if (keyedValues.length === 3) {
    return [key1, key2, key3];
  }

  const legacy = (process.env["NVIDIA_API_KEY"] ?? "").trim();
  if (legacy.length > 0) {
    return [legacy];
  }

  throw new Error("Missing required NVIDIA API key configuration");
}

function buildOpenRouterProvider(): OpenRouterProvider {
  const endpoint = process.env["OPENROUTER_ENDPOINT"];
  const options = {
    apiKeys: readOpenRouterApiKeys(),
    appName: process.env["OPENROUTER_APP_NAME"] ?? "stackforge-api",
    appUrl: process.env["OPENROUTER_APP_URL"] ?? "http://localhost",
    ...(endpoint !== undefined && endpoint.trim().length > 0 ? { endpoint } : {}),
  };

  return new OpenRouterProvider(options);
}

function buildNvidiaProvider(): NvidiaProvider {
  const endpoint = process.env["NVIDIA_ENDPOINT"];
  return new NvidiaProvider({
    apiKeys: readNvidiaApiKeys(),
    model: process.env["NVIDIA_CODEGEN_MODEL"]?.trim() || "moonshotai/kimi-k2.5",
    appName: process.env["NVIDIA_APP_NAME"] ?? "stackforge-codegen",
    appUrl: process.env["NVIDIA_APP_URL"] ?? "http://localhost",
    ...(endpoint !== undefined && endpoint.trim().length > 0 ? { endpoint } : {}),
  });
}

function buildProvider(mode: ProviderMode): LLMProvider {
  if (mode === "mock") {
    return new MockProvider();
  }

  return buildOpenRouterProvider();
}

let provider: LLMProvider | undefined;
let providerMode: ProviderMode | undefined;
let codegenProviderMode: CodegenProviderMode | undefined;
let nvidiaCodegenProvider: LLMProvider | undefined;

function getProvider(): LLMProvider {
  if (provider === undefined) {
    providerMode = resolveProviderMode();
    provider = buildProvider(providerMode);
  }

  return provider;
}

function getCodegenProvider(): LLMProvider | undefined {
  if (codegenProviderMode === undefined) {
    codegenProviderMode = resolveCodegenProviderMode();
  }

  if (codegenProviderMode !== "nvidia") {
    return undefined;
  }

  if (nvidiaCodegenProvider === undefined) {
    nvidiaCodegenProvider = buildNvidiaProvider();
  }

  return nvidiaCodegenProvider;
}

function getOrchestrationProvider(execution?: GenerateExecution): LLMProvider {
  const baseProvider = getProvider();
  if (!isCodeGenerationEnabled(execution)) {
    return baseProvider;
  }

  const codegenProvider = getCodegenProvider();
  if (codegenProvider === undefined) {
    return baseProvider;
  }

  return new AgentRoutingProvider(baseProvider, codegenProvider);
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

function isCodeGenerationEnabled(execution?: GenerateExecution): boolean {
  return execution?.enableCodeGeneration ?? true;
}

function inferProviderFromModel(model: string): string {
  const normalized = model.toLowerCase();

  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "google";
  }

  if (normalized.includes("groq")) {
    return "groq";
  }

  if (normalized.includes("openai") || normalized.startsWith("gpt-")) {
    return "openai";
  }

  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "anthropic";
  }

  if (normalized.includes("nvidia") || normalized.includes("moonshot") || normalized.includes("kimi")) {
    return "nvidia";
  }

  const slash = normalized.indexOf("/");
  if (slash > 0) {
    return normalized.slice(0, slash);
  }

  return "unknown";
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

function estimateExpectedAgentsTotal(prompt: string, execution?: GenerateExecution): number {
  const selectedWorkflow = selectWorkflow(prompt);
  const expectedSteps = selectedWorkflow.steps.filter(
    (step) => isCodeGenerationEnabled(execution) || step.agent !== "codegen",
  );

  return Math.max(1, expectedSteps.length);
}

function buildEmitter(
  jobId: string,
  expectedAgentsTotal: number,
  baseProviderName: string,
  codegenProviderName: string | undefined,
): (event: SSEEvent) => void {
  return (event: SSEEvent): void => {
    appendEvent(jobId, event);

    if (event.type === "job_created") {
      initRun(jobId, { agentsTotal: expectedAgentsTotal });
    }

    if (event.type === "agent_started") {
      const startedAgent = event.agent as AgentName;
      const provider = event.agent === "codegen"
        ? (codegenProviderName ?? baseProviderName)
        : baseProviderName;

      const plannedModel = event.agent === "codegen" && codegenProviderName === "nvidia"
        ? (process.env["NVIDIA_CODEGEN_MODEL"]?.trim() || "moonshotai/kimi-k2.5")
        : AGENT_CONFIGS[startedAgent].model;

      recordProviderCall(jobId, provider, plannedModel);
    }

    if (event.type === "agent_completed") {
      const job = getJob(jobId);
      if (job !== undefined && !job.agentsCompleted.includes(event.agent as AgentName)) {
        updateJob(jobId, { agentsCompleted: [...job.agentsCompleted, event.agent as AgentName] });

      }

      const provider = event.agent === "codegen"
        ? (codegenProviderName ?? inferProviderFromModel(event.payload.model))
        : (baseProviderName || inferProviderFromModel(event.payload.model));

      recordAgentTokens(jobId, event.agent, provider, event.payload.model, event.payload.totalTokens);
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
  expectedAgentsTotal: number,
  baseProviderName: string,
  codegenProviderName: string | undefined,
  execution?: GenerateExecution,
): Promise<void> {
  const emit = buildEmitter(jobId, expectedAgentsTotal, baseProviderName, codegenProviderName);
  const jobStart = Date.now();

  try {
    updateJob(jobId, { status: JOB_STATUS.RUNNING });

    const blueprint = await runOrchestrator({
      jobId,
      prompt,
      projectName,
      ...(execution !== undefined ? { execution } : {}),
      emit,
      provider: getOrchestrationProvider(execution),
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

export function generateProject(
  prompt: string,
  projectName: string,
  options?: GenerateProjectOptions,
): StoredJob {
  const job = createJob(prompt, projectName);
  const expectedAgentsTotal = estimateExpectedAgentsTotal(prompt, options?.execution);
  const baseProviderName = getProvider().name;
  const codegenProviderName = isCodeGenerationEnabled(options?.execution)
    ? getCodegenProvider()?.name
    : undefined;
  const emit = buildEmitter(job.id, expectedAgentsTotal, baseProviderName, codegenProviderName);

  emit({
    type: "job_created",
    jobId: job.id,
    timestamp: job.createdAt,
    payload: {
      prompt,
      projectName: job.projectName,
    },
  });

  void startOrchestration(
    job.id,
    prompt,
    job.projectName,
    expectedAgentsTotal,
    baseProviderName,
    codegenProviderName,
    options?.execution,
  );

  return job;
}
