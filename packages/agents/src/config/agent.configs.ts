import type { AgentConfig, AgentName } from "@stackforge/shared";

/**
 * Resolve the model for an agent, allowing env overrides.
 *
 * Precedence (highest first):
 *   1. STACKFORGE_MODEL_<AGENT>   e.g. STACKFORGE_MODEL_PLANNER
 *   2. STACKFORGE_MODEL           global override for every agent
 *   3. the hardcoded default passed in
 *
 * This lets a free OpenRouter model be swapped in without editing source,
 * either per-agent or across the whole pipeline.
 */
function resolveModel(agent: AgentName, fallback: string): string {
  const perAgent = process.env[`STACKFORGE_MODEL_${agent.toUpperCase()}`]?.trim();
  if (perAgent !== undefined && perAgent.length > 0) {
    return perAgent;
  }

  const global = process.env["STACKFORGE_MODEL"]?.trim();
  if (global !== undefined && global.length > 0) {
    return global;
  }

  return fallback;
}

/**
 * Scale factor applied to every agent's output budget (maxOutputTokens and
 * tokenBudget). Lets a demo give models more room without editing per-agent
 * numbers. Defaults to 1 (no change), so existing behaviour and tests are
 * unaffected. Set e.g. STACKFORGE_OUTPUT_SCALE=1.6 to loosen caps.
 */
const OUTPUT_SCALE = (() => {
  const raw = Number.parseFloat(process.env["STACKFORGE_OUTPUT_SCALE"] ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
})();

/**
 * Global override for every agent's compression aggressiveness. When unset,
 * each agent keeps its own default level. Set STACKFORGE_COMPRESSION=low to
 * reduce context loss (better output on weak models, higher token cost).
 */
const COMPRESSION_OVERRIDE: AgentConfig["compressionLevel"] | undefined = (() => {
  const raw = (process.env["STACKFORGE_COMPRESSION"] ?? "").trim().toLowerCase();
  return raw === "low" || raw === "medium" || raw === "high" ? raw : undefined;
})();

function scaleOutput(value: number): number {
  return Math.round(value * OUTPUT_SCALE);
}

function resolveCompression(fallback: AgentConfig["compressionLevel"]): AgentConfig["compressionLevel"] {
  return COMPRESSION_OVERRIDE ?? fallback;
}

export const AGENT_CONFIGS: Record<AgentName, AgentConfig> = {
  planner: {
    name: "planner",
    description: "Resolves stack, project name, and top-level folder structure",
    tokenBudget: scaleOutput(1000),
    model: resolveModel("planner", "openai/gpt-4o-mini"),
    maxInputTokens: 900,
    maxOutputTokens: scaleOutput(700),
    minOutputTokens: 220,
    temperature: 0.2,
    compressionLevel: resolveCompression("high"),
    budgetOverflowRetries: 2,
    retries: 1,
  },
  schema: {
    name: "schema",
    description: "Designs entities, fields, indexes, and relationships",
    tokenBudget: scaleOutput(1500),
    model: resolveModel("schema", "openai/gpt-4o-mini"),
    maxInputTokens: 1200,
    maxOutputTokens: scaleOutput(1100),
    minOutputTokens: 320,
    temperature: 0.1,
    compressionLevel: resolveCompression("medium"),
    budgetOverflowRetries: 2,
    retries: 1,
  },
  api: {
    name: "api",
    description: "Plans REST routes, request/response shapes, and auth requirements",
    tokenBudget: scaleOutput(1600),
    model: resolveModel("api", "openai/gpt-4o-mini"),
    maxInputTokens: 950,
    maxOutputTokens: scaleOutput(1200),
    minOutputTokens: 280,
    temperature: 0.1,
    compressionLevel: resolveCompression("medium"),
    budgetOverflowRetries: 2,
    retries: 1,
  },
  frontend: {
    name: "frontend",
    description: "Plans pages, React component trees, and routing",
    tokenBudget: scaleOutput(1200),
    model: resolveModel("frontend", "openai/gpt-4o-mini"),
    maxInputTokens: 900,
    maxOutputTokens: scaleOutput(900),
    minOutputTokens: 250,
    temperature: 0.2,
    compressionLevel: resolveCompression("high"),
    budgetOverflowRetries: 2,
    retries: 1,
  },
  devops: {
    name: "devops",
    description: "Plans CI/CD pipelines, deployment targets, Docker, and env vars",
    tokenBudget: scaleOutput(1000),
    model: resolveModel("devops", "openai/gpt-4o-mini"),
    maxInputTokens: 700,
    maxOutputTokens: scaleOutput(850),
    minOutputTokens: 180,
    temperature: 0.2,
    compressionLevel: resolveCompression("high"),
    budgetOverflowRetries: 3,
    retries: 1,
  },
  reviewer: {
    name: "reviewer",
    description: "Performs consistency checks and flags issues across the full blueprint",
    tokenBudget: scaleOutput(1200),
    model: resolveModel("reviewer", "openai/gpt-4o-mini"),
    maxInputTokens: 850,
    maxOutputTokens: scaleOutput(900),
    minOutputTokens: 220,
    temperature: 0,
    compressionLevel: resolveCompression("high"),
    budgetOverflowRetries: 2,
    retries: 1,
  },
  codegen: {
    name: "codegen",
    description: "Generates concrete source files from the finalized blueprint",
    tokenBudget: scaleOutput(2200),
    model: resolveModel("codegen", "openai/gpt-4o-mini"),
    maxInputTokens: 1100,
    maxOutputTokens: scaleOutput(1200),
    minOutputTokens: 280,
    temperature: 0.1,
    compressionLevel: resolveCompression("medium"),
    budgetOverflowRetries: 3,
    retries: 1,
  },
};
