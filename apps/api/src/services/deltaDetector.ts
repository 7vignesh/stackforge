import type { LLMProvider } from "@stackforge/agents";
import { AGENT_CONFIGS } from "@stackforge/agents";

export const FEATURE_AGENT_ORDER = ["planner", "schema", "api", "frontend", "devops"] as const;

export type FeatureAgentId = (typeof FEATURE_AGENT_ORDER)[number];

const KEYWORD_MAP: Array<{ agent: FeatureAgentId; keywords: string[] }> = [
  {
    agent: "schema",
    keywords: [
      "schema",
      "entity",
      "model",
      "table",
      "column",
      "database",
      "migration",
      "index",
      "relation",
      "postgres",
      "mysql",
      "mongodb",
      "stripe",
      "payment",
    ],
  },
  {
    agent: "api",
    keywords: [
      "api",
      "endpoint",
      "route",
      "controller",
      "rest",
      "graphql",
      "webhook",
      "auth",
      "stripe",
      "payment",
      "checkout",
    ],
  },
  {
    agent: "frontend",
    keywords: [
      "frontend",
      "ui",
      "screen",
      "page",
      "component",
      "form",
      "button",
      "dashboard",
      "checkout",
      "payment",
      "stripe",
    ],
  },
  {
    agent: "devops",
    keywords: [
      "docker",
      "deploy",
      "deployment",
      "ci",
      "cd",
      "pipeline",
      "infra",
      "kubernetes",
      "helm",
      "vercel",
      "railway",
      "environment",
      "env",
      "secret",
    ],
  },
  {
    agent: "planner",
    keywords: [
      "architecture",
      "stack",
      "project",
      "monorepo",
      "folder",
      "structure",
      "technology",
      "framework",
    ],
  },
];

function normalizeAgents(agents: string[]): FeatureAgentId[] {
  const asSet = new Set<string>(agents.map((agent) => agent.trim().toLowerCase()));
  return FEATURE_AGENT_ORDER.filter((agent) => asSet.has(agent));
}

function detectByKeyword(featureRequest: string): FeatureAgentId[] {
  const lowered = featureRequest.toLowerCase();
  const hits = new Set<FeatureAgentId>();

  for (const { agent, keywords } of KEYWORD_MAP) {
    if (keywords.some((keyword) => lowered.includes(keyword))) {
      hits.add(agent);
    }
  }

  if (hits.size === 0) {
    return [];
  }

  return FEATURE_AGENT_ORDER.filter((agent) => hits.has(agent));
}

function readAgentsFromProviderOutput(output: unknown): FeatureAgentId[] {
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    return [];
  }

  const record = output as Record<string, unknown>;
  const rawAgents = record["agents"];

  if (!Array.isArray(rawAgents)) {
    return [];
  }

  const candidates = rawAgents
    .filter((item) => typeof item === "string")
    .map((item) => item as string);

  return normalizeAgents(candidates);
}

export async function detectAffectedAgents(
  featureRequest: string,
  provider: LLMProvider,
): Promise<FeatureAgentId[]> {
  const keywordDetected = detectByKeyword(featureRequest);
  if (keywordDetected.length > 0) {
    return keywordDetected;
  }

  try {
    const plannerConfig = AGENT_CONFIGS.planner;
    const response = await provider.call({
      agentName: "planner",
      input: { featureRequest },
      options: {
        systemPrompt: [
          "You are a strict classifier for software feature updates.",
          "Given a feature request, select affected agents from this exact list: planner, schema, api, frontend, devops.",
          "Return JSON object only with shape: { \"agents\": [\"schema\", \"api\"] }",
          "Do not include any other keys.",
        ].join("\n"),
        userPrompt: `Feature request: ${featureRequest}`,
        model: plannerConfig.model,
        maxInputTokens: Math.min(300, plannerConfig.maxInputTokens),
        maxOutputTokens: Math.min(120, plannerConfig.maxOutputTokens),
        temperature: 0,
      },
    });

    const llmDetected = readAgentsFromProviderOutput(response.output);
    if (llmDetected.length > 0) {
      return llmDetected;
    }
  } catch {
    // Fall through to safe default.
  }

  return ["planner", "schema", "api", "frontend", "devops"];
}
