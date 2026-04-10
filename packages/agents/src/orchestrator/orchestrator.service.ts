import type {
  Blueprint,
  SSEEvent,
  AgentName,
  ReviewerInput,
} from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { runPlannerAgent } from "../agents/planner.agent.js";
import { runSchemaAgent } from "../agents/schema.agent.js";
import { runApiAgent } from "../agents/api.agent.js";
import { runFrontendAgent } from "../agents/frontend.agent.js";
import { runDevopsAgent } from "../agents/devops.agent.js";
import { runReviewerAgent } from "../agents/reviewer.agent.js";

export type OrchestratorOptions = {
  jobId: string;
  prompt: string;
  projectName: string;
  emit: (event: SSEEvent) => void;
  provider: LLMProvider;
  cache: AgentCache;
};

function now(): string {
  return new Date().toISOString();
}

function agentStarted(jobId: string, agent: AgentName): SSEEvent {
  return { type: "agent_started", jobId, agent, timestamp: now(), payload: {} };
}

function agentToken(jobId: string, agentId: AgentName, token: string): SSEEvent {
  return {
    type: "agent_token",
    jobId,
    agentId,
    token,
    timestamp: Date.now(),
  };
}

function agentComplete(jobId: string, agentId: AgentName, fullOutput: unknown): SSEEvent {
  return {
    type: "agent_complete",
    jobId,
    agentId,
    fullOutput,
    timestamp: Date.now(),
  };
}

function agentCompleted(
  jobId: string,
  agent: AgentName,
  durationMs: number,
  cached: boolean,
  inputTokens: number,
  outputTokens: number,
  totalTokens: number,
  tokensUsed: number,
  estimatedInputTokens: number,
  compressionPasses: number,
  providerInputTokens: number,
  providerOutputTokens: number,
  model: string,
): SSEEvent {
  return {
    type: "agent_completed",
    jobId,
    agent,
    timestamp: now(),
    payload: {
      durationMs,
      cached,
      inputTokens,
      outputTokens,
      totalTokens,
      tokensUsed,
      estimatedInputTokens,
      compressionPasses,
      providerInputTokens,
      providerOutputTokens,
      model,
    },
  };
}

function agentFailed(jobId: string, agent: AgentName, error: string): SSEEvent {
  return { type: "agent_failed", jobId, agent, timestamp: now(), payload: { error } };
}

async function runWithEmit<T>(
  jobId: string,
  agentName: AgentName,
  emit: (event: SSEEvent) => void,
  fn: (hooks: { onToken: (chunk: string) => void }) => Promise<{
    output: T;
    cached: boolean;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    tokensUsed: number;
    estimatedInputTokens: number;
    compressionPasses: number;
    providerInputTokens: number;
    providerOutputTokens: number;
    model: string;
  }>,
): Promise<T> {
  emit(agentStarted(jobId, agentName));
  try {
    const result = await fn({
      onToken: (chunk) => {
        if (chunk.length === 0) {
          return;
        }
        emit(agentToken(jobId, agentName, chunk));
      },
    });
    emit(agentComplete(jobId, agentName, result.output));
    emit(
      agentCompleted(
        jobId,
        agentName,
        result.durationMs,
        result.cached,
        result.inputTokens,
        result.outputTokens,
        result.totalTokens,
        result.tokensUsed,
        result.estimatedInputTokens,
        result.compressionPasses,
        result.providerInputTokens,
        result.providerOutputTokens,
        result.model,
      ),
    );
    return result.output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(agentFailed(jobId, agentName, msg));
    throw err;
  }
}

export async function runOrchestrator(options: OrchestratorOptions): Promise<Blueprint> {
  const { jobId, prompt, projectName, emit, provider, cache } = options;

  // 1. Planner — resolves stack and folder structure
  const plannerOutput = await runWithEmit(jobId, "planner", emit, (hooks) =>
    runPlannerAgent({ prompt, projectName }, provider, cache, hooks),
  );

  // 2. Schema — designs entities using the resolved stack
  const schemaOutput = await runWithEmit(jobId, "schema", emit, (hooks) =>
    runSchemaAgent({ prompt, projectName, stack: plannerOutput.stack }, provider, cache, hooks),
  );

  // 3. API — plans routes using entities + stack (no schema raw output passed)
  const apiOutput = await runWithEmit(jobId, "api", emit, (hooks) =>
    runApiAgent(
      { prompt, entities: schemaOutput.entities, stack: plannerOutput.stack },
      provider,
      cache,
      hooks,
    ),
  );

  // 4. Frontend — plans pages using entities + routes + stack
  const frontendOutput = await runWithEmit(jobId, "frontend", emit, (hooks) =>
    runFrontendAgent(
      {
        prompt,
        entities: schemaOutput.entities,
        routePlan: apiOutput.routePlan,
        stack: plannerOutput.stack,
      },
      provider,
      cache,
      hooks,
    ),
  );

  // 5. Devops — plans infra using stack + entities only (no page/route details)
  const devopsOutput = await runWithEmit(jobId, "devops", emit, (hooks) =>
    runDevopsAgent(
      { prompt, stack: plannerOutput.stack, entities: schemaOutput.entities },
      provider,
      cache,
      hooks,
    ),
  );

  // 6. Reviewer — receives compact pre-blueprint (extracted fields, no raw agent payloads)
  const reviewerInput: ReviewerInput = {
    prompt,
    projectName: plannerOutput.projectName,
    stack: plannerOutput.stack,
    folderStructure: plannerOutput.folderStructure,
    entities: schemaOutput.entities,
    relationships: schemaOutput.relationships,
    routePlan: apiOutput.routePlan,
    frontendPages: frontendOutput.frontendPages,
    infraPlan: devopsOutput.infraPlan,
    generatedFilesPlan: devopsOutput.generatedFilesPlan,
  };

  const reviewerOutput = await runWithEmit(jobId, "reviewer", emit, (hooks) =>
    runReviewerAgent(reviewerInput, provider, cache, hooks),
  );

  // Aggregate — merge per-agent outputs into final blueprint
  const blueprint: Blueprint = {
    projectName: plannerOutput.projectName,
    generatedAt: now(),
    stack: plannerOutput.stack,
    folderStructure: plannerOutput.folderStructure,
    entities: schemaOutput.entities,
    relationships: schemaOutput.relationships,
    routePlan: apiOutput.routePlan,
    frontendPages: frontendOutput.frontendPages,
    infraPlan: devopsOutput.infraPlan,
    generatedFilesPlan: devopsOutput.generatedFilesPlan,
    reviewerNotes: reviewerOutput.reviewerNotes,
  };

  return blueprint;
}
