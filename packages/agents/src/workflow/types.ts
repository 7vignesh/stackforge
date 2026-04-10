import type { AgentName, SSEEvent } from "@stackforge/shared";

export type SkillHeader = {
  name: string;
  triggers: string[];
  description: string;
  inputs: string[];
  outputs: string[];
};

export type WorkflowState = Record<string, string>;

export type WorkflowStep = {
  id: string;
  skill: string;
  stateKey: string;
  compressionTarget: number;
  emitEvent: "agent_started";
  agent: AgentName;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
};

export type WorkflowEmit = (event: SSEEvent) => void;
