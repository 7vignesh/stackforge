import type { WorkflowDefinition } from "./types.js";

const FULLSTACK_SCAFFOLD_WORKFLOW: WorkflowDefinition = {
  id: "fullstack-scaffold",
  name: "Full Stack Scaffold",
  description: "Generates a new full-stack blueprint with compact state handoffs.",
  steps: [
    {
      id: "step-1",
      skill: "project-planner",
      stateKey: "plan",
      compressionTarget: 150,
      emitEvent: "agent_started",
      agent: "planner",
    },
    {
      id: "step-2",
      skill: "schema-generator",
      stateKey: "schema",
      compressionTarget: 150,
      emitEvent: "agent_started",
      agent: "schema",
    },
    {
      id: "step-3",
      skill: "api-route-generator",
      stateKey: "api",
      compressionTarget: 140,
      emitEvent: "agent_started",
      agent: "api",
    },
    {
      id: "step-4",
      skill: "component-generator",
      stateKey: "frontend",
      compressionTarget: 140,
      emitEvent: "agent_started",
      agent: "frontend",
    },
    {
      id: "step-5",
      skill: "config-generator",
      stateKey: "devops",
      compressionTarget: 120,
      emitEvent: "agent_started",
      agent: "devops",
    },
    {
      id: "step-6",
      skill: "config-generator",
      stateKey: "reviewer",
      compressionTarget: 120,
      emitEvent: "agent_started",
      agent: "reviewer",
    },
    {
      id: "step-7",
      skill: "component-generator",
      stateKey: "codegen",
      compressionTarget: 180,
      emitEvent: "agent_started",
      agent: "codegen",
    },
  ],
};

const FEATURE_ADD_WORKFLOW: WorkflowDefinition = {
  id: "feature-add",
  name: "Feature Add",
  description: "Adds a focused feature to an existing scaffold with bounded context.",
  steps: [
    {
      id: "feature-step-1",
      skill: "project-planner",
      stateKey: "plan",
      compressionTarget: 130,
      emitEvent: "agent_started",
      agent: "planner",
    },
    {
      id: "feature-step-2",
      skill: "schema-generator",
      stateKey: "schema",
      compressionTarget: 130,
      emitEvent: "agent_started",
      agent: "schema",
    },
    {
      id: "feature-step-3",
      skill: "api-route-generator",
      stateKey: "api",
      compressionTarget: 120,
      emitEvent: "agent_started",
      agent: "api",
    },
    {
      id: "feature-step-4",
      skill: "component-generator",
      stateKey: "frontend",
      compressionTarget: 120,
      emitEvent: "agent_started",
      agent: "frontend",
    },
    {
      id: "feature-step-5",
      skill: "config-generator",
      stateKey: "devops",
      compressionTarget: 110,
      emitEvent: "agent_started",
      agent: "devops",
    },
  ],
};

const FEATURE_PROMPT_HINTS = ["add", "adding", "feature", "update", "modify"];

function hasFeatureIntent(userPrompt: string): boolean {
  const lowered = userPrompt.toLowerCase();
  return FEATURE_PROMPT_HINTS.some((hint) => {
    const matcher = new RegExp(`\\b${hint}\\b`, "i");
    return matcher.test(lowered);
  });
}

export function selectWorkflow(userPrompt: string): WorkflowDefinition {
  const isFeatureFlow = hasFeatureIntent(userPrompt);

  return isFeatureFlow ? FEATURE_ADD_WORKFLOW : FULLSTACK_SCAFFOLD_WORKFLOW;
}
