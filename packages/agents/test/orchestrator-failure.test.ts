/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { ProviderCallInput, ProviderCallOutput } from "../src/provider/provider.interface.js";
import type { LLMProvider } from "../src/provider/provider.interface.js";
import { runOrchestrator } from "../src/orchestrator/orchestrator.service.js";
import { AgentCache } from "../src/cache/agent.cache.js";
import type { SSEEvent } from "@stackforge/shared";
import {
  buildPlannerOutput,
  buildSchemaOutput,
  buildApiOutput,
  buildFrontendOutput,
  buildDevopsOutput,
  buildReviewerOutput,
  buildCodegenOutput,
} from "../src/provider/mock.data.js";

class InvalidPlannerProvider implements LLMProvider {
  readonly name = "invalid-planner";

  async call({ agentName }: ProviderCallInput): Promise<ProviderCallOutput> {
    if (agentName === "planner") {
      return {
        output: { bad: true },
        tokensUsed: 42,
        durationMs: 5,
        inputTokens: 20,
        outputTokens: 22,
        model: "test-model",
      };
    }

    return {
      output: {},
      tokensUsed: 1,
      durationMs: 1,
      inputTokens: 1,
      outputTokens: 0,
      model: "test-model",
    };
  }
}

function extractProjectName(input: unknown): string {
  if (
    input !== null &&
    typeof input === "object" &&
    "projectName" in input &&
    typeof (input as Record<string, unknown>)["projectName"] === "string"
  ) {
    return (input as Record<string, unknown>)["projectName"] as string;
  }

  return "generated-project";
}

class FixedTokenProvider implements LLMProvider {
  readonly name = "fixed-token-provider";

  async call({ agentName, input, options }: ProviderCallInput): Promise<ProviderCallOutput> {
    const projectName = extractProjectName(input);

    if (agentName === "planner") {
      return {
        output: buildPlannerOutput(projectName),
        tokensUsed: 150,
        durationMs: 3,
        inputTokens: 70,
        outputTokens: 80,
        model: options.model,
      };
    }

    if (agentName === "schema") {
      return {
        output: buildSchemaOutput(),
        tokensUsed: 150,
        durationMs: 3,
        inputTokens: 70,
        outputTokens: 80,
        model: options.model,
      };
    }

    if (agentName === "api") {
      return {
        output: buildApiOutput(),
        tokensUsed: 150,
        durationMs: 3,
        inputTokens: 70,
        outputTokens: 80,
        model: options.model,
      };
    }

    if (agentName === "frontend") {
      return {
        output: buildFrontendOutput(),
        tokensUsed: 150,
        durationMs: 3,
        inputTokens: 70,
        outputTokens: 80,
        model: options.model,
      };
    }

    if (agentName === "devops") {
      return {
        output: buildDevopsOutput(projectName),
        tokensUsed: 150,
        durationMs: 3,
        inputTokens: 70,
        outputTokens: 80,
        model: options.model,
      };
    }

    if (agentName === "codegen") {
      return {
        output: buildCodegenOutput(projectName),
        tokensUsed: 150,
        durationMs: 3,
        inputTokens: 70,
        outputTokens: 80,
        model: options.model,
      };
    }

    return {
      output: buildReviewerOutput(),
      tokensUsed: 150,
      durationMs: 3,
      inputTokens: 70,
      outputTokens: 80,
      model: options.model,
    };
  }
}

class CompressionFailureProvider extends FixedTokenProvider {
  override async call(input: ProviderCallInput): Promise<ProviderCallOutput> {
    const payload = input.input as Record<string, unknown>;
    if ("compressionTarget" in payload) {
      throw new Error("compression request failed");
    }

    return super.call(input);
  }
}

describe("Orchestrator failure propagation", () => {
  it("emits agent_failed and rejects when agent output schema validation fails", async () => {
    const events: SSEEvent[] = [];
    const provider = new InvalidPlannerProvider();

    await expect(
      runOrchestrator({
        jobId: crypto.randomUUID(),
        prompt: "Build a task management platform",
        projectName: "taskflow",
        emit: (event) => events.push(event),
        provider,
        cache: new AgentCache(),
      }),
    ).rejects.toBeDefined();

    const started = events.find((event) => event.type === "agent_started" && event.agent === "planner");
    const failed = events.find((event) => event.type === "agent_failed" && event.agent === "planner");

    expect(started).toBeDefined();
    expect(failed).toBeDefined();
    if (failed?.type === "agent_failed") {
      expect(failed.payload.error.length).toBeGreaterThan(0);
    }
  });

  it("rejects when strict global token budget is exceeded", async () => {
    await expect(
      runOrchestrator({
        jobId: crypto.randomUUID(),
        prompt: "Build a task management platform",
        projectName: "taskflow",
        execution: {
          tokenBudget: {
            maxTotalTokens: 420,
            enforcement: "strict",
          },
        },
        emit: () => {},
        provider: new FixedTokenProvider(),
        cache: new AgentCache(),
      }),
    ).rejects.toThrow("Global token budget");
  });

  it("includes generated source files when code generation is enabled", async () => {
    const blueprint = await runOrchestrator({
      jobId: crypto.randomUUID(),
      prompt: "Build a task management platform",
      projectName: "taskflow",
      execution: {
        enableCodeGeneration: true,
      },
      emit: () => {},
      provider: new FixedTokenProvider(),
      cache: new AgentCache(),
    });

    expect((blueprint.generatedSourceFiles?.length ?? 0) > 0).toBe(true);
    expect(blueprint.generatedSourceFiles?.[0]?.path.length).toBeGreaterThan(0);
    expect(blueprint.generatedSourceFiles?.[0]?.content.length).toBeGreaterThan(0);
  });

  it("continues orchestration when compression pass fails", async () => {
    const blueprint = await runOrchestrator({
      jobId: crypto.randomUUID(),
      prompt: "Build a task management platform",
      projectName: "taskflow",
      execution: {
        enableCodeGeneration: true,
      },
      emit: () => {},
      provider: new CompressionFailureProvider(),
      cache: new AgentCache(),
    });

    expect(blueprint.routePlan.length).toBeGreaterThan(0);
    expect(blueprint.reviewerNotes.length).toBeGreaterThan(0);
    expect((blueprint.generatedSourceFiles?.length ?? 0) > 0).toBe(true);
  });
});
