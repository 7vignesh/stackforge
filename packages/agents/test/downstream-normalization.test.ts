/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "../src/provider/provider.interface.js";
import { runOrchestrator } from "../src/orchestrator/orchestrator.service.js";
import { AgentCache } from "../src/cache/agent.cache.js";
import type { SSEEvent } from "@stackforge/shared";
import {
  buildPlannerOutput,
  buildReviewerOutput,
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

class PartialDownstreamProvider implements LLMProvider {
  readonly name = "partial-downstream";

  async call({ agentName, input, options }: ProviderCallInput): Promise<ProviderCallOutput> {
    const projectName = extractProjectName(input);

    if (agentName === "planner") {
      return {
        output: buildPlannerOutput(projectName),
        tokensUsed: 100,
        durationMs: 5,
        inputTokens: 40,
        outputTokens: 60,
        model: options.model,
      };
    }

    if (agentName === "schema") {
      return {
        output: {
          entities: [
            {
              name: "Task",
            },
          ],
          relationships: [
            {
              from: "Task",
            },
          ],
        },
        tokensUsed: 100,
        durationMs: 5,
        inputTokens: 40,
        outputTokens: 60,
        model: options.model,
      };
    }

    if (agentName === "api") {
      return {
        output: {
          routePlan: [
            {
              method: "post",
              path: "tasks",
            },
          ],
        },
        tokensUsed: 100,
        durationMs: 5,
        inputTokens: 40,
        outputTokens: 60,
        model: options.model,
      };
    }

    if (agentName === "frontend") {
      return {
        output: {
          frontendPages: [
            {
              route: "tasks",
            },
          ],
        },
        tokensUsed: 100,
        durationMs: 5,
        inputTokens: 40,
        outputTokens: 60,
        model: options.model,
      };
    }

    if (agentName === "devops") {
      return {
        output: {
          infraPlan: {
            docker: true,
          },
          generatedFilesPlan: [
            {
              path: "Dockerfile",
            },
          ],
        },
        tokensUsed: 100,
        durationMs: 5,
        inputTokens: 40,
        outputTokens: 60,
        model: options.model,
      };
    }

    if (agentName === "reviewer") {
      const base = buildReviewerOutput();
      return {
        output: {
          reviewerNotes: [
            {
              note: base.reviewerNotes[0]?.note ?? "Looks good",
            },
          ],
        },
        tokensUsed: 100,
        durationMs: 5,
        inputTokens: 40,
        outputTokens: 60,
        model: options.model,
      };
    }

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

describe("Downstream output normalization", () => {
  it("fills missing required keys for schema/api/frontend/devops/reviewer", async () => {
    const events: SSEEvent[] = [];

    const blueprint = await runOrchestrator({
      jobId: crypto.randomUUID(),
      prompt: "Build a simple todo application",
      projectName: "todo-stack",
      emit: (event) => events.push(event),
      provider: new PartialDownstreamProvider(),
      cache: new AgentCache(),
    });

    expect(blueprint.entities.length).toBeGreaterThan(0);
    expect(blueprint.entities[0]?.tableName.length).toBeGreaterThan(0);
    expect((blueprint.entities[0]?.fields.length ?? 0) > 0).toBe(true);

    expect(blueprint.routePlan.length).toBeGreaterThan(0);
    expect(blueprint.routePlan[0]?.responseType.length).toBeGreaterThan(0);

    expect(blueprint.frontendPages.length).toBeGreaterThan(0);
    expect((blueprint.frontendPages[0]?.components.length ?? 0) > 0).toBe(true);

    expect(blueprint.infraPlan.ci).toBeArray();
    expect(blueprint.infraPlan.deployment).toBeArray();
    expect(blueprint.infraPlan.envVars).toBeArray();

    expect(blueprint.generatedFilesPlan.length).toBeGreaterThan(0);
    expect(blueprint.generatedFilesPlan[0]?.generator.length).toBeGreaterThan(0);

    expect(blueprint.reviewerNotes.length).toBeGreaterThan(0);
    expect(blueprint.reviewerNotes[0]?.severity).toBe("info");
    expect(blueprint.reviewerNotes[0]?.agent.length).toBeGreaterThan(0);

    const failedEvent = events.find((event) => event.type === "agent_failed");
    expect(failedEvent).toBeUndefined();
  });
});
