/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "@stackforge/agents";
import { detectAffectedAgents } from "../src/services/deltaDetector.js";

class ThrowingProvider implements LLMProvider {
  readonly name = "throwing";

  async call(_input: ProviderCallInput): Promise<ProviderCallOutput> {
    throw new Error("provider failure");
  }
}

describe("deltaDetector", () => {
  it("detects schema/api/frontend agents for stripe request via keywords", async () => {
    const provider = new ThrowingProvider();

    const result = await detectAffectedAgents("Add Stripe payments and checkout page", provider);

    expect(result).toContain("schema");
    expect(result).toContain("api");
    expect(result).toContain("frontend");
  });

  it("falls back to all core agents when no keyword and provider fails", async () => {
    const provider = new ThrowingProvider();

    const result = await detectAffectedAgents("Do something magical", provider);

    expect(result).toEqual(["planner", "schema", "api", "frontend", "devops"]);
  });
});
