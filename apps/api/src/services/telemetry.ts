import { AGENT_NAMES, type Telemetry } from "@stackforge/shared";

type BucketName = "gemini" | "groq";

type TelemetryStore = Map<string, Telemetry>;
type BreakdownStats = { calls: number; tokens: number };

const USD_PER_1K_GEMINI = 0.000075;
const USD_PER_1K_GROQ = 0.000059;
const USD_TO_INR = 85;

const runs: TelemetryStore = new Map();

function cloneTelemetry(telemetry: Telemetry): Telemetry {
  return {
    ...telemetry,
    tokensByAgent: { ...telemetry.tokensByAgent },
    providerBreakdown: Object.fromEntries(
      Object.entries(telemetry.providerBreakdown).map(([name, stats]) => [name, { ...stats }]),
    ),
    modelBreakdown: Object.fromEntries(
      Object.entries(telemetry.modelBreakdown).map(([name, stats]) => [name, { ...stats }]),
    ),
  };
}

function ensureBreakdownEntry(
  map: Record<string, BreakdownStats>,
  key: string,
): BreakdownStats {
  if (map[key] === undefined) {
    map[key] = { calls: 0, tokens: 0 };
  }

  return map[key];
}

function inferCostBucket(modelName: string): BucketName {
  const normalized = modelName.toLowerCase();
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "gemini";
  }

  return "groq";
}

function normalizeCost(value: number): number {
  if (value < 0.01) return 0;
  return Number(value.toFixed(2));
}

function computeCostINR(telemetry: Telemetry): number {
  let geminiTokens = 0;
  let groqTokens = 0;

  for (const [modelName, stats] of Object.entries(telemetry.modelBreakdown)) {
    if (inferCostBucket(modelName) === "gemini") {
      geminiTokens += stats.tokens;
    } else {
      groqTokens += stats.tokens;
    }
  }

  const geminiUsd = (geminiTokens / 1000) * USD_PER_1K_GEMINI;
  const groqUsd = (groqTokens / 1000) * USD_PER_1K_GROQ;
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

export function initRun(runId: string, options?: { agentsTotal?: number }): Telemetry {
  const requestedTotal = options?.agentsTotal;
  const agentsTotal =
    typeof requestedTotal === "number" && Number.isFinite(requestedTotal)
      ? Math.max(1, Math.floor(requestedTotal))
      : AGENT_NAMES.length;

  const telemetry: Telemetry = {
    runId,
    startTime: Date.now(),
    endTime: null,
    elapsedTimeMs: 0,
    agentsTotal,
    agentsCompleted: 0,
    totalTokensUsed: 0,
    tokensByAgent: {},
    providerBreakdown: {},
    modelBreakdown: {},
    estimatedCostINR: 0,
  };

  runs.set(runId, telemetry);
  return cloneTelemetry(telemetry);
}

export function recordAgentTokens(
  runId: string,
  agentId: string,
  provider: string,
  model: string,
  tokenCount: number,
): Telemetry | undefined {
  return withRun(runId, (telemetry) => {
    const safeTokens = Number.isFinite(tokenCount) ? Math.max(0, Math.floor(tokenCount)) : 0;
    const normalizedProvider = provider.trim().length > 0 ? provider.trim().toLowerCase() : "unknown";
    const normalizedModel = model.trim().length > 0 ? model.trim().toLowerCase() : "unknown";

    const providerStats = ensureBreakdownEntry(telemetry.providerBreakdown, normalizedProvider);
    const modelStats = ensureBreakdownEntry(telemetry.modelBreakdown, normalizedModel);

    telemetry.totalTokensUsed += safeTokens;
    telemetry.tokensByAgent[agentId] = (telemetry.tokensByAgent[agentId] ?? 0) + safeTokens;
    providerStats.tokens += safeTokens;
    modelStats.tokens += safeTokens;
  });
}

export function recordProviderCall(
  runId: string,
  provider: string,
  model: string,
): Telemetry | undefined {
  return withRun(runId, (telemetry) => {
    const normalizedProvider = provider.trim().length > 0 ? provider.trim().toLowerCase() : "unknown";
    const normalizedModel = model.trim().length > 0 ? model.trim().toLowerCase() : "unknown";

    const providerStats = ensureBreakdownEntry(telemetry.providerBreakdown, normalizedProvider);
    const modelStats = ensureBreakdownEntry(telemetry.modelBreakdown, normalizedModel);

    providerStats.calls += 1;
    modelStats.calls += 1;
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
