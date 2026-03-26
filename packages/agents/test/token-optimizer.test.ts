/// <reference types="bun" />
import { describe, it, expect } from "bun:test";
import { optimizeAgentPayload } from "../src/optimizer/token.optimizer.js";
import { AGENT_CONFIGS } from "../src/config/agent.configs.js";

describe("Token optimizer", () => {
  it("compresses oversized prompt input within configured input token limit", () => {
    const veryLongPrompt = "Build enterprise app. ".repeat(3000);

    const result = optimizeAgentPayload("planner", {
      prompt: veryLongPrompt,
      projectName: "planner-test",
    });

    expect(result.maxInputTokens).toBe(900);
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(result.maxInputTokens);
    expect(result.compressionPasses).toBeGreaterThanOrEqual(1);
    expect(result.userPrompt.length).toBeLessThanOrEqual(result.maxInputTokens * 4);
  });

  it("fails fast when remaining budget cannot satisfy minimum output tokens", () => {
    const original = AGENT_CONFIGS.devops.minOutputTokens;
    AGENT_CONFIGS.devops.minOutputTokens = AGENT_CONFIGS.devops.tokenBudget;

    try {
      expect(() =>
        optimizeAgentPayload("devops", {
          prompt: "x".repeat(40000),
          stack: { backend: "express", database: "postgres" },
          entities: Array.from({ length: 200 }, (_, index) => ({ name: `Entity${index}` })),
        }),
      ).toThrow("Insufficient output token budget");
    } finally {
      AGENT_CONFIGS.devops.minOutputTokens = original;
    }
  });
});
