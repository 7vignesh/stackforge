import type { AgentName, SSEEvent } from "@stackforge/shared";
import { AGENT_CONFIGS } from "../config/agent.configs.js";
import type { AgentCache } from "../cache/agent.cache.js";
import type { LLMProvider, ProviderCallOutput } from "../provider/provider.interface.js";
import type { SkillRegistry } from "../skills/registry.js";
import type { WorkflowDefinition, WorkflowEmit, WorkflowState, WorkflowStep } from "./types.js";

type WorkflowStepResult = {
  rawOutput: unknown;
  compressedOutput: string;
  tokensUsed: number;
};

export type WorkflowRunMeta = {
  rawOutputsByStateKey: Record<string, unknown>;
  totalTokensUsed: number;
  tokensByAgent: Partial<Record<AgentName, number>>;
};

export type WorkflowEngineOptions = {
  jobId: string;
  userGoal: string;
  provider: LLMProvider;
  cache: AgentCache;
  emit: WorkflowEmit;
  skillRegistry: SkillRegistry;
};

function nowIso(): string {
  return new Date().toISOString();
}

function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(normalized.length / 4));
}

function serializeOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function compactStateForPrompt(state: WorkflowState): string {
  const entries = Object.entries(state);
  if (entries.length === 0) {
    return "(no previous step output yet)";
  }

  return entries
    .map(([key, value]) => {
      const normalized = value.length > 2000 ? `${value.slice(0, 2000)}\n...(truncated)` : value;
      return `## ${key}\n${normalized}`;
    })
    .join("\n\n");
}

function buildStepUserPrompt(step: WorkflowStep, skillBody: string, goal: string, state: WorkflowState): string {
  return [
    `Workflow step: ${step.id}`,
    `Target state key: ${step.stateKey}`,
    "",
    "Original user goal:",
    goal,
    "",
    "Current workflow context:",
    compactStateForPrompt(state),
    "",
    "Active skill instructions:",
    skillBody,
    "",
    "Return strict JSON object output for this step.",
  ].join("\n");
}

function buildCompressionPrompt(compressionTarget: number, stepOutputText: string): string {
  return [
    `Summarise the following in under ${compressionTarget} tokens, preserving all file names,`,
    "technology decisions, and structural choices. Omit code implementations:",
    "Return strict JSON only in this exact shape: { \"summary\": string }.",
    stepOutputText,
  ].join("\n");
}

function toCompressedString(output: unknown): string {
  if (typeof output === "string") {
    return output.trim();
  }

  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    const summaryCandidate = (output as Record<string, unknown>)["summary"];
    if (typeof summaryCandidate === "string" && summaryCandidate.trim().length > 0) {
      return summaryCandidate.trim();
    }
  }

  return serializeOutput(output).trim();
}

function fallbackCompress(stepOutputText: string, compressionTarget: number): string {
  const normalized = stepOutputText.trim();
  if (normalized.length === 0) {
    return "{}";
  }

  const maxChars = Math.max(320, compressionTarget * 8);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}\n...(compression fallback: truncated)`;
}

function hasRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateStepOutput(step: WorkflowStep, output: unknown): void {
  // Special handling for codegen which can be either string or record
  if (step.stateKey === "codegen") {
    const isString = typeof output === "string";
    if (isString) {
      // Convert string output to structured format for downstream processing
      return; // String is valid, will be wrapped when processing
    }
    if (!hasRecord(output)) {
      throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
    }
    const hasGeneratedFiles = Array.isArray(output["generatedSourceFiles"]);
    const hasFileMap = hasRecord(output["files"]);
    if (!hasGeneratedFiles && !hasFileMap) {
      throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
    }
    return;
  }

  if (!hasRecord(output)) {
    throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
  }

  switch (step.stateKey) {
    case "plan": {
      const hasProjectName = typeof output["projectName"] === "string";
      const hasStack = hasRecord(output["stack"]);
      const hasFolder = Array.isArray(output["folderStructure"]);
      if (!hasProjectName || !hasStack || !hasFolder) {
        throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
      }
      return;
    }
    case "schema": {
      if (!Array.isArray(output["entities"]) || !Array.isArray(output["relationships"])) {
        throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
      }
      return;
    }
    case "api": {
      if (!Array.isArray(output["routePlan"])) {
        throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
      }
      return;
    }
    case "frontend": {
      if (!Array.isArray(output["frontendPages"])) {
        throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
      }
      return;
    }
    case "devops": {
      const hasInfra = hasRecord(output["infraPlan"]);
      const hasFilesPlan = Array.isArray(output["generatedFilesPlan"]);
      if (!hasInfra || !hasFilesPlan) {
        throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
      }
      return;
    }
    case "reviewer": {
      if (!Array.isArray(output["reviewerNotes"])) {
        throw new Error(`Invalid output shape for step '${step.id}' (${step.stateKey})`);
      }
      return;
    }
    default:
      return;
  }
}

function agentStarted(jobId: string, agent: AgentName): SSEEvent {
  return { type: "agent_started", jobId, agent, timestamp: nowIso(), payload: {} };
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
  payload: {
    durationMs: number;
    cached: boolean;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    tokensUsed: number;
    estimatedInputTokens: number;
    compressionPasses: number;
    providerInputTokens: number;
    providerOutputTokens: number;
    model: string;
  },
): SSEEvent {
  return {
    type: "agent_completed",
    jobId,
    agent,
    timestamp: nowIso(),
    payload,
  };
}

function agentFailed(jobId: string, agent: AgentName, error: string): SSEEvent {
  return { type: "agent_failed", jobId, agent, timestamp: nowIso(), payload: { error } };
}

export class WorkflowEngine {
  private lastRunMeta: WorkflowRunMeta | undefined;

  constructor(private readonly options: WorkflowEngineOptions) {}

  getLastRunMeta(): WorkflowRunMeta | undefined {
    return this.lastRunMeta;
  }

  async run(workflow: WorkflowDefinition, initialState: WorkflowState): Promise<WorkflowState> {
    const state: WorkflowState = { ...initialState };
    const rawOutputsByStateKey: Record<string, unknown> = {};
    const tokensByAgent: Partial<Record<AgentName, number>> = {};
    let totalTokensUsed = 0;

    for (const step of workflow.steps) {
      const stepResult = await this.runStep(workflow, step, state);
      state[step.stateKey] = stepResult.compressedOutput;
      rawOutputsByStateKey[step.stateKey] = stepResult.rawOutput;

      totalTokensUsed += stepResult.tokensUsed;
      tokensByAgent[step.agent] = (tokensByAgent[step.agent] ?? 0) + stepResult.tokensUsed;
    }

    this.lastRunMeta = {
      rawOutputsByStateKey,
      totalTokensUsed,
      tokensByAgent,
    };

    return state;
  }

  private async runStep(
    workflow: WorkflowDefinition,
    step: WorkflowStep,
    state: WorkflowState,
  ): Promise<WorkflowStepResult> {
    const skillBody = await this.options.skillRegistry.loadSkill(step.skill);
    const config = AGENT_CONFIGS[step.agent];
    const userPrompt = buildStepUserPrompt(step, skillBody, this.options.userGoal, state);
    const estimatedInputTokens = estimateTokens(userPrompt) + estimateTokens(skillBody);

    this.options.emit(agentStarted(this.options.jobId, step.agent));

    let primary: ProviderCallOutput;
    let cachedPrimary = false;
    const primaryCacheKey = this.options.cache.hash({
      type: "workflow-step",
      workflowId: workflow.id,
      stepId: step.id,
      skill: step.skill,
      prompt: userPrompt,
      model: config.model,
      maxOutputTokens: config.maxOutputTokens,
    });

    try {
      const primaryCachedEntry = this.options.cache.get(primaryCacheKey);
      if (primaryCachedEntry !== undefined) {
        cachedPrimary = true;
        primary = {
          output: primaryCachedEntry.output,
          tokensUsed: 0,
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          model: config.model,
        };
      } else {
        const streamedChunks: string[] = [];
        primary = await this.options.provider.call({
          agentName: step.agent,
          input: {
            workflowId: workflow.id,
            stepId: step.id,
            stepSkill: step.skill,
            goal: this.options.userGoal,
            state,
          },
          options: {
            systemPrompt: "Execute the requested workflow step and return strict JSON object output only.",
            userPrompt,
            model: config.model,
            maxInputTokens: config.maxInputTokens,
            maxOutputTokens: config.maxOutputTokens,
            temperature: config.temperature,
          },
          onToken: (chunk) => {
            if (chunk.length === 0) {
              return;
            }
            streamedChunks.push(chunk);
            this.options.emit(agentToken(this.options.jobId, step.agent, chunk));
          },
        });

        this.options.cache.set(primaryCacheKey, primary.output);

        // If provider responded without streaming callback, emit the full output once for UI parity.
        if (streamedChunks.length === 0) {
          const fallbackToken = serializeOutput(primary.output);
          if (fallbackToken.length > 0) {
            this.options.emit(agentToken(this.options.jobId, step.agent, fallbackToken));
          }
        }
      }

      validateStepOutput(step, primary.output);

      // Convert raw code string to structured format for codegen
      let normalizedOutput = primary.output;
      if (step.agent === "codegen" && typeof primary.output === "string") {
        normalizedOutput = {
          generatedSourceFiles: [
            {
              path: "generated-code.ts",
              language: "typescript",
              content: primary.output,
            },
          ],
        };
      }

      this.options.emit(agentComplete(this.options.jobId, step.agent, normalizedOutput));

      const providerInputTokens = primary.inputTokens ?? estimatedInputTokens;
      const serializedPrimary = serializeOutput(normalizedOutput);
      const providerOutputTokens = primary.outputTokens ?? estimateTokens(serializedPrimary);
      const totalTokens = primary.tokensUsed > 0
        ? primary.tokensUsed
        : providerInputTokens + providerOutputTokens;

      this.options.emit(
        agentCompleted(this.options.jobId, step.agent, {
          durationMs: primary.durationMs,
          cached: cachedPrimary,
          inputTokens: providerInputTokens,
          outputTokens: providerOutputTokens,
          totalTokens,
          tokensUsed: totalTokens,
          estimatedInputTokens,
          compressionPasses: 1,
          providerInputTokens,
          providerOutputTokens,
          model: primary.model ?? config.model,
        }),
      );

      if (step.agent === "codegen") {
        return {
          rawOutput: normalizedOutput,
          compressedOutput: serializeOutput(normalizedOutput),
          tokensUsed: totalTokens,
        };
      }

      const compressedOutput = await this.compressStepOutput(
        workflow,
        step,
        normalizedOutput,
        config.model,
        config.temperature,
      );

      return {
        rawOutput: normalizedOutput,
        compressedOutput: compressedOutput.text,
        tokensUsed: totalTokens + compressedOutput.tokensUsed,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.emit(agentFailed(this.options.jobId, step.agent, message));
      throw error;
    }
  }

  private async compressStepOutput(
    workflow: WorkflowDefinition,
    step: WorkflowStep,
    stepOutput: unknown,
    model: string,
    temperature: number,
  ): Promise<{ text: string; tokensUsed: number }> {
    const stepOutputText = serializeOutput(stepOutput);
    const prompt = buildCompressionPrompt(step.compressionTarget, stepOutputText);

    const cacheKey = this.options.cache.hash({
      type: "workflow-compression",
      workflowId: workflow.id,
      stepId: step.id,
      target: step.compressionTarget,
      model,
      prompt,
    });

    const cached = this.options.cache.get(cacheKey);
    if (cached !== undefined) {
      return {
        text: toCompressedString(cached.output),
        tokensUsed: 0,
      };
    }

    const response = await this.options.provider.call({
      agentName: step.agent,
      input: {
        workflowId: workflow.id,
        stepId: step.id,
        compressionTarget: step.compressionTarget,
      },
      options: {
        systemPrompt: "You compress structured output without dropping key architecture details. Return strict JSON object output only.",
        userPrompt: prompt,
        model,
        maxInputTokens: Math.max(128, step.compressionTarget * 4),
        maxOutputTokens: Math.max(64, step.compressionTarget + 80),
        temperature: Math.min(temperature, 0.2),
      },
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[workflow] compression fallback for ${workflow.id}/${step.id}: ${message}\n`,
      );

      return {
        output: { summary: fallbackCompress(stepOutputText, step.compressionTarget) },
        tokensUsed: 0,
        durationMs: 0,
      } as ProviderCallOutput;
    });

    this.options.cache.set(cacheKey, response.output);

    return {
      text: toCompressedString(response.output),
      tokensUsed: response.tokensUsed,
    };
  }
}
