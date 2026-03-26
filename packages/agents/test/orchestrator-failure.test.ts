/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { ProviderCallInput, ProviderCallOutput } from "../src/provider/provider.interface.js";
import type { LLMProvider } from "../src/provider/provider.interface.js";
import { runOrchestrator } from "../src/orchestrator/orchestrator.service.js";
import { AgentCache } from "../src/cache/agent.cache.js";
import type { SSEEvent } from "@stackforge/shared";

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
});
