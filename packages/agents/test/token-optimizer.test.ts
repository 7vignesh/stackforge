/// <reference types="bun" />
import { describe, it, expect } from "bun:test";
import { encodingForModel } from "js-tiktoken";
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

    const tokenizer = encodingForModel("gpt-4o-mini");
    const measuredTokens =
      tokenizer.encode(result.systemPrompt).length +
      tokenizer.encode(result.userPrompt).length +
      20;
    expect(measuredTokens).toBeLessThanOrEqual(result.maxInputTokens);
  });

  it("recursively compresses nested arrays and objects", () => {
    const hugeEntities = Array.from({ length: 28 }, (_, entityIndex) => ({
      name: `Entity${entityIndex}`,
      tableName: `entity_${entityIndex}`,
      fields: Array.from({ length: 24 }, (_, fieldIndex) => ({
        name: `field_${fieldIndex}`,
        type: "varchar(255)",
        description: "x".repeat(180),
        nullable: fieldIndex % 2 === 0,
      })),
      description: "This is a large entity description that repeats. ".repeat(24),
    }));

    const result = optimizeAgentPayload("reviewer", {
      prompt: "Review this architecture for consistency and security.",
      projectName: "compress-test",
      stack: { frontend: "react", backend: "express", database: "postgres" },
      entities: hugeEntities,
      relationships: [],
      routePlan: [],
      frontendPages: [],
      infraPlan: { ci: ["test"], docker: true, deployment: ["railway"], envVars: ["DATABASE_URL"] },
      generatedFilesPlan: [],
    });

    const optimized = result.optimizedInput as { entities?: Array<{ fields?: unknown[] }> };
    expect(Array.isArray(optimized.entities)).toBe(true);
    expect((optimized.entities ?? []).length).toBeLessThanOrEqual(12);
    expect(((optimized.entities ?? [])[0]?.fields ?? []).length).toBeLessThanOrEqual(12);
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(result.maxInputTokens);
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

  it("respects runtime token constraints for per-request caps", () => {
    const result = optimizeAgentPayload(
      "planner",
      {
        prompt: "Build a collaborative kanban app with real-time updates and comments.",
        projectName: "runtime-cap-test",
      },
      {
        tokenBudgetLimit: 700,
        maxOutputTokensLimit: 300,
      },
    );

    expect(result.maxOutputTokens).toBeLessThanOrEqual(300);
    expect(result.maxOutputTokens).toBeLessThanOrEqual(700 - result.estimatedInputTokens);
  });
});
