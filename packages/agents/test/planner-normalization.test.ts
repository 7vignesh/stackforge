/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "../src/provider/provider.interface.js";
import { runOrchestrator } from "../src/orchestrator/orchestrator.service.js";
import { AgentCache } from "../src/cache/agent.cache.js";
import type { SSEEvent } from "@stackforge/shared";
import {
  buildSchemaOutput,
  buildApiOutput,
  buildFrontendOutput,
  buildDevopsOutput,
  buildReviewerOutput,
  buildCodegenOutput,
} from "../src/provider/mock.data.js";

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

class PartialPlannerProvider implements LLMProvider {
  readonly name = "partial-planner";

  async call({ agentName, input, options }: ProviderCallInput): Promise<ProviderCallOutput> {
    if (agentName === "planner") {
      return {
        output: {
          projectName: "todo-stack",
          stack: {
            frontend: "React + Vite",
            backend: "Express",
            database: "PostgreSQL",
            packageManager: "Bun",
          },
          folderStructure: [
            { path: "apps/api/src", type: "directory" },
            { path: "README.md" },
          ],
        },
        tokensUsed: 100,
        durationMs: 5,
        inputTokens: 40,
        outputTokens: 60,
        model: options.model,
      };
    }

    const projectName = extractProjectName(input);

    switch (agentName) {
      case "schema":
        return {
          output: buildSchemaOutput(),
          tokensUsed: 100,
          durationMs: 5,
          inputTokens: 40,
          outputTokens: 60,
          model: options.model,
        };
      case "api":
        return {
          output: buildApiOutput(),
          tokensUsed: 100,
          durationMs: 5,
          inputTokens: 40,
          outputTokens: 60,
          model: options.model,
        };
      case "frontend":
        return {
          output: buildFrontendOutput(),
          tokensUsed: 100,
          durationMs: 5,
          inputTokens: 40,
          outputTokens: 60,
          model: options.model,
        };
      case "devops":
        return {
          output: buildDevopsOutput(projectName),
          tokensUsed: 100,
          durationMs: 5,
          inputTokens: 40,
          outputTokens: 60,
          model: options.model,
        };
      case "reviewer":
        return {
          output: buildReviewerOutput(),
          tokensUsed: 100,
          durationMs: 5,
          inputTokens: 40,
          outputTokens: 60,
          model: options.model,
        };
      case "codegen":
        return {
          output: buildCodegenOutput(projectName),
          tokensUsed: 100,
          durationMs: 5,
          inputTokens: 40,
          outputTokens: 60,
          model: options.model,
        };
      default:
        return {
          output: {},
          tokensUsed: 1,
          durationMs: 1,
          inputTokens: 1,
          outputTokens: 0,
          model: options.model,
        };
    }
  }
}

describe("Planner output normalization", () => {
  it("fills missing planner stack keys and normalizes folder node types", async () => {
    const events: SSEEvent[] = [];

    const blueprint = await runOrchestrator({
      jobId: crypto.randomUUID(),
      prompt: "Build a simple todo application",
      projectName: "todo-stack",
      emit: (event) => events.push(event),
      provider: new PartialPlannerProvider(),
      cache: new AgentCache(),
    });

    expect(blueprint.projectName).toBe("todo-stack");
    expect(blueprint.stack.frontend).toBe("React + Vite");
    expect(blueprint.stack.auth.length).toBeGreaterThan(0);
    expect(blueprint.stack.hosting.length).toBeGreaterThan(0);

    const apiFolder = blueprint.folderStructure.find((node) => node.path === "apps/api/src");
    expect(apiFolder?.type).toBe("dir");

    const readmeFile = blueprint.folderStructure.find((node) => node.path === "README.md");
    expect(readmeFile?.type).toBe("file");

    const plannerCompleted = events.find(
      (event) => event.type === "agent_completed" && event.agent === "planner",
    );
    expect(plannerCompleted).toBeDefined();
  });
});
