export const AGENT_NAMES = [
  "planner",
  "schema",
  "api",
  "frontend",
  "devops",
  "reviewer",
  "codegen",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];
