import type { AgentName } from "@stackforge/shared";

export type AgentPrompt = {
  systemPrompt: string;
  userPrompt: string;
};

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function pick(input: unknown, keys: string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object") {
    return { input };
  }

  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) {
      out[key] = source[key];
    }
  }

  return out;
}

const SYSTEM_INSTRUCTIONS: Record<AgentName, string> = {
  planner:
    "You are the planner agent. Create a concise project foundation. Respond with strict JSON only: { projectName, stack, folderStructure }.",
  schema:
    "You are the schema agent. Design normalized entities and relationships. Respond with strict JSON only: { entities, relationships }.",
  api:
    "You are the api agent. Plan minimal complete REST routes with auth metadata. Respond with strict JSON only: { routePlan }.",
  frontend:
    "You are the frontend agent. Plan pages and component groupings mapped to routes. Respond with strict JSON only: { frontendPages }.",
  devops:
    "You are the devops agent. Plan deployable infra, env vars, and generated files. Respond with strict JSON only: { infraPlan, generatedFilesPlan }.",
  reviewer:
    "You are the reviewer agent. Identify consistency, reliability, and security issues. Respond with strict JSON only: { reviewerNotes }.",
};

const CONTEXT_KEYS: Record<AgentName, string[]> = {
  planner: ["prompt", "projectName"],
  schema: ["prompt", "projectName", "stack"],
  api: ["prompt", "entities", "stack"],
  frontend: ["prompt", "entities", "routePlan", "stack"],
  devops: ["prompt", "stack", "entities"],
  reviewer: [
    "prompt",
    "projectName",
    "stack",
    "entities",
    "relationships",
    "routePlan",
    "frontendPages",
    "infraPlan",
    "generatedFilesPlan",
  ],
};

export function buildAgentPrompt(agentName: AgentName, input: unknown): AgentPrompt {
  const context = pick(input, CONTEXT_KEYS[agentName]);

  return {
    systemPrompt:
      `${SYSTEM_INSTRUCTIONS[agentName]} Never return markdown, code fences, comments, or extra keys.`,
    userPrompt: stringify(context),
  };
}
