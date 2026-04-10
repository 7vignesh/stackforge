/// <reference types="bun" />
import { describe, it, expect } from "bun:test";
import {
  finalizeRun,
  getTelemetry,
  initRun,
  recordAgentComplete,
  recordAgentTokens,
} from "../src/services/telemetry.js";

describe("telemetry service", () => {
  it("tracks provider breakdown, progress, and finalized elapsed time", () => {
    const runId = crypto.randomUUID();

    const initial = initRun(runId);
    expect(initial.runId).toBe(runId);
    expect(initial.agentsTotal).toBeGreaterThan(0);
    expect(initial.endTime).toBeNull();

    recordAgentTokens(runId, "planner", "gemini", 2100);
    recordAgentComplete(runId, "planner");
    recordAgentTokens(runId, "api", "groq", 3200);
    recordAgentComplete(runId, "api");

    const mid = getTelemetry(runId);
    expect(mid).toBeDefined();
    expect(mid?.totalTokensUsed).toBe(5300);
    expect(mid?.agentsCompleted).toBe(2);
    expect(mid?.providerBreakdown.gemini.calls).toBe(1);
    expect(mid?.providerBreakdown.groq.calls).toBe(1);
    expect(mid?.providerBreakdown.gemini.tokens).toBe(2100);
    expect(mid?.providerBreakdown.groq.tokens).toBe(3200);
    expect(mid?.estimatedCostINR).toBeGreaterThanOrEqual(0);

    const finalized = finalizeRun(runId);
    expect(finalized?.endTime).not.toBeNull();
    expect(finalized?.elapsedTimeMs).toBeGreaterThanOrEqual(0);

    const finalSnapshot = getTelemetry(runId);
    expect(finalSnapshot?.endTime).toBe(finalized?.endTime);
  });

  it("rounds tiny cost values down to INR 0.00 equivalent", () => {
    const runId = crypto.randomUUID();
    initRun(runId);

    recordAgentTokens(runId, "schema", "gemini", 1);

    const snapshot = getTelemetry(runId);
    expect(snapshot?.estimatedCostINR).toBe(0);
  });
});
