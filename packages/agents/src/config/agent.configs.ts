import type { AgentConfig, AgentName } from "@stackforge/shared";

export const AGENT_CONFIGS: Record<AgentName, AgentConfig> = {
  planner: {
    name: "planner",
    description: "Resolves stack, project name, and top-level folder structure",
    tokenBudget: 1000,
    retries: 1,
  },
  schema: {
    name: "schema",
    description: "Designs entities, fields, indexes, and relationships",
    tokenBudget: 1500,
    retries: 1,
  },
  api: {
    name: "api",
    description: "Plans REST routes, request/response shapes, and auth requirements",
    tokenBudget: 1200,
    retries: 1,
  },
  frontend: {
    name: "frontend",
    description: "Plans pages, React component trees, and routing",
    tokenBudget: 1200,
    retries: 1,
  },
  devops: {
    name: "devops",
    description: "Plans CI/CD pipelines, deployment targets, Docker, and env vars",
    tokenBudget: 800,
    retries: 1,
  },
  reviewer: {
    name: "reviewer",
    description: "Performs consistency checks and flags issues across the full blueprint",
    tokenBudget: 1000,
    retries: 1,
  },
};
