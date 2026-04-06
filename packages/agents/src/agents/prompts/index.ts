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
    "You are the planner agent. Create a concise project foundation. Respond with strict JSON only using exactly this shape: { projectName: string, stack: { frontend: string, backend: string, database: string, auth: string, hosting: string, packageManager: string, monorepo: boolean }, folderStructure: Array<{ path: string, type: 'file' | 'dir', description?: string }> }. Do not omit any stack keys and never return null or undefined values.",
  schema:
    "You are the schema agent. Design normalized entities and relationships. Respond with strict JSON only using exactly this shape: { entities: Array<{ name: string, tableName: string, fields: Array<{ name: string, type: string, nullable: boolean, unique?: boolean, foreignKey?: string }>, indexes?: string[] }>, relationships: Array<{ from: string, to: string, type: 'one-to-one' | 'one-to-many' | 'many-to-many', description: string }> }. Never omit required keys and never use null or undefined.",
  api:
    "You are the api agent. Plan minimal complete REST routes with auth metadata. Respond with strict JSON only using exactly this shape: { routePlan: Array<{ method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, description: string, auth: boolean, requestBody?: string, responseType: string }> }. Never omit required keys and never use null or undefined.",
  frontend:
    "You are the frontend agent. Plan pages and component groupings mapped to routes. Respond with strict JSON only using exactly this shape: { frontendPages: Array<{ route: string, name: string, components: string[], auth: boolean, description: string }> }. Never omit required keys and never use null or undefined.",
  devops:
    "You are the devops agent. Plan deployable infra, env vars, and generated files. Respond with strict JSON only using exactly this shape: { infraPlan: { ci: string[], docker: boolean, deployment: string[], envVars: string[] }, generatedFilesPlan: Array<{ path: string, generator: string, description: string }> }. Never omit required keys and never use null or undefined.",
  reviewer:
    "You are the reviewer agent. Identify consistency, reliability, and security issues. Respond with strict JSON only using exactly this shape: { reviewerNotes: Array<{ severity: 'info' | 'warning' | 'error', agent: string, note: string }> }. Never omit required keys and never use null or undefined.",
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

export function extractAgentContext(agentName: AgentName, input: unknown): Record<string, unknown> {
  return pick(input, CONTEXT_KEYS[agentName]);
}

export function buildAgentPrompt(agentName: AgentName, input: unknown): AgentPrompt {
  const context = extractAgentContext(agentName, input);

  return {
    systemPrompt:
      `${SYSTEM_INSTRUCTIONS[agentName]} Never return markdown, code fences, comments, or extra keys.`,
    userPrompt: stringify(context),
  };
}
