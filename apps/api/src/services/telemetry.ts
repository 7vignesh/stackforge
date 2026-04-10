import { AGENT_NAMES, type Telemetry } from "@stackforge/shared";

type ProviderName = "gemini" | "groq";

type TelemetryStore = Map<string, Telemetry>;

const USD_PER_1K_GEMINI = 0.000075;
const USD_PER_1K_GROQ = 0.000059;
const USD_TO_INR = 85;

const runs: TelemetryStore = new Map();

function cloneTelemetry(telemetry: Telemetry): Telemetry {
  return {
    ...telemetry,
    tokensByAgent: { ...telemetry.tokensByAgent },
    providerBreakdown: {
      gemini: { ...telemetry.providerBreakdown.gemini },
      groq: { ...telemetry.providerBreakdown.groq },
    },
  };
}

function normalizeCost(value: number): number {
  if (value < 0.01) return 0;
  return Number(value.toFixed(2));
}

function computeCostINR(telemetry: Telemetry): number {
  const geminiUsd = (telemetry.providerBreakdown.gemini.tokens / 1000) * USD_PER_1K_GEMINI;
  const groqUsd = (telemetry.providerBreakdown.groq.tokens / 1000) * USD_PER_1K_GROQ;
  return normalizeCost((geminiUsd + groqUsd) * USD_TO_INR);
}

function updateCost(telemetry: Telemetry): void {
  telemetry.estimatedCostINR = computeCostINR(telemetry);
}

function withRun(runId: string, updater: (telemetry: Telemetry) => void): Telemetry | undefined {
  const telemetry = runs.get(runId);
  if (telemetry === undefined) return undefined;

  updater(telemetry);
  updateCost(telemetry);
  return cloneTelemetry(telemetry);
}

export function initRun(runId: string): Telemetry {
  const telemetry: Telemetry = {
    runId,
    startTime: Date.now(),
    endTime: null,
    elapsedTimeMs: 0,
    agentsTotal: AGENT_NAMES.length,
    agentsCompleted: 0,
    totalTokensUsed: 0,
    tokensByAgent: {},
    providerBreakdown: {
      gemini: { calls: 0, tokens: 0 },
      groq: { calls: 0, tokens: 0 },
    },
    estimatedCostINR: 0,
  };

  runs.set(runId, telemetry);
  return cloneTelemetry(telemetry);
}

export function recordAgentTokens(
  runId: string,
  agentId: string,
  provider: ProviderName,
  tokenCount: number,
): Telemetry | undefined {
  return withRun(runId, (telemetry) => {
    const safeTokens = Number.isFinite(tokenCount) ? Math.max(0, Math.floor(tokenCount)) : 0;
    telemetry.totalTokensUsed += safeTokens;
    telemetry.tokensByAgent[agentId] = (telemetry.tokensByAgent[agentId] ?? 0) + safeTokens;
    telemetry.providerBreakdown[provider].tokens += safeTokens;
    telemetry.providerBreakdown[provider].calls += 1;
  });
}

export function recordAgentComplete(runId: string, _agentId: string): Telemetry | undefined {
  return withRun(runId, (telemetry) => {
    telemetry.agentsCompleted = Math.min(telemetry.agentsCompleted + 1, telemetry.agentsTotal);
  });
}

export function finalizeRun(runId: string): Telemetry | undefined {
  return withRun(runId, (telemetry) => {
    if (telemetry.endTime !== null) {
      return;
    }

    telemetry.endTime = Date.now();
    telemetry.elapsedTimeMs = Math.max(0, telemetry.endTime - telemetry.startTime);
  });
}

export function getTelemetry(runId: string): Telemetry | undefined {
  const telemetry = runs.get(runId);
  if (telemetry === undefined) return undefined;

  if (telemetry.endTime === null) {
    telemetry.elapsedTimeMs = Math.max(0, Date.now() - telemetry.startTime);
  }

  return cloneTelemetry(telemetry);
}
