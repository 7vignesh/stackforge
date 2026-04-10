import type { AgentName } from "../constants/agents.js";
import type {
  Blueprint,
  TechStack,
  Entity,
  Relationship,
  ApiRoute,
  FrontendPage,
  InfraPlan,
  GeneratedFile,
  FolderNode,
  GeneratedSourceFile,
} from "../schemas/blueprint.schema.js";

// ─── Agent config interface (instances live in packages/agents) ───────────────

export type AgentConfig = {
  name: AgentName;
  description: string;
  tokenBudget: number;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  minOutputTokens: number;
  temperature: number;
  compressionLevel: "low" | "medium" | "high";
  budgetOverflowRetries: number;
  retries: number;
};

// ─── Compact per-agent handoff inputs ────────────────────────────────────────

export type PlannerInput = {
  prompt: string;
  projectName: string;
};

export type SchemaInput = {
  prompt: string;
  projectName: string;
  stack: TechStack;
};

export type ApiAgentInput = {
  prompt: string;
  entities: Entity[];
  stack: TechStack;
};

export type FrontendInput = {
  prompt: string;
  entities: Entity[];
  routePlan: ApiRoute[];
  stack: TechStack;
};

export type DevopsInput = {
  prompt: string;
  stack: TechStack;
  entities: Entity[];
};

export type ReviewerInput = {
  prompt: string;
  projectName: string;
  stack: TechStack;
  folderStructure: FolderNode[];
  entities: Entity[];
  relationships: Relationship[];
  routePlan: ApiRoute[];
  frontendPages: FrontendPage[];
  infraPlan: InfraPlan;
  generatedFilesPlan: GeneratedFile[];
};

export type CodegenInput = {
  prompt: string;
  projectName: string;
  stack: TechStack;
  entities: Entity[];
  relationships: Relationship[];
  routePlan: ApiRoute[];
  frontendPages: FrontendPage[];
  infraPlan: InfraPlan;
  generatedFilesPlan: GeneratedFile[];
  reviewerNotes: Blueprint["reviewerNotes"];
};

// ─── Per-agent structured outputs ────────────────────────────────────────────

export type PlannerOutput = {
  projectName: string;
  stack: TechStack;
  folderStructure: FolderNode[];
};

export type SchemaOutput = {
  entities: Entity[];
  relationships: Relationship[];
};

export type ApiAgentOutput = {
  routePlan: ApiRoute[];
};

export type FrontendOutput = {
  frontendPages: FrontendPage[];
};

export type DevopsOutput = {
  infraPlan: InfraPlan;
  generatedFilesPlan: GeneratedFile[];
};

export type ReviewerOutput = {
  reviewerNotes: Blueprint["reviewerNotes"];
};

export type CodegenOutput =
  | { generatedSourceFiles: GeneratedSourceFile[] }
  | string;

// ─── Union of all agent outputs ───────────────────────────────────────────────

export type AgentOutput =
  | PlannerOutput
  | SchemaOutput
  | ApiAgentOutput
  | FrontendOutput
  | DevopsOutput
  | ReviewerOutput
  | CodegenOutput;
