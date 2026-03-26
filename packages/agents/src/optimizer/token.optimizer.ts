import type { AgentName } from "@stackforge/shared";
import { AGENT_CONFIGS } from "../config/agent.configs.js";

export type OptimizedAgentPayload = {
  optimizedInput: unknown;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
};

const AGENT_REQUIREMENTS: Record<AgentName, string> = {
  planner: "Return only JSON with keys: projectName, stack, folderStructure.",
  schema: "Return only JSON with keys: entities, relationships.",
  api: "Return only JSON with key: routePlan.",
  frontend: "Return only JSON with key: frontendPages.",
  devops: "Return only JSON with keys: infraPlan, generatedFilesPlan.",
  reviewer: "Return only JSON with key: reviewerNotes.",
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function trimPromptValue(value: unknown, maxChars: number): unknown {
  if (typeof value !== "string") {
    return value;
  }

  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(0, maxChars);
}

function compressInput(input: unknown, maxInputTokens: number): unknown {
  const maxChars = maxInputTokens * 4;

  if (input === null || typeof input !== "object") {
    return trimPromptValue(input, maxChars);
  }

  const shallow = { ...(input as Record<string, unknown>) };

  if ("prompt" in shallow) {
    shallow["prompt"] = trimPromptValue(shallow["prompt"], Math.floor(maxChars * 0.7));
  }

  if ("description" in shallow) {
    shallow["description"] = trimPromptValue(shallow["description"], Math.floor(maxChars * 0.2));
  }

  let serialized = JSON.stringify(shallow);
  if (serialized.length <= maxChars) {
    return shallow;
  }

  if ("prompt" in shallow) {
    const prompt = shallow["prompt"];
    if (typeof prompt === "string") {
      shallow["prompt"] = trimPromptValue(prompt, Math.floor(maxChars * 0.45));
    }
  }

  serialized = JSON.stringify(shallow);
  if (serialized.length <= maxChars) {
    return shallow;
  }

  return { prompt: serialized.slice(0, maxChars) };
}

export function optimizeAgentPayload(agentName: AgentName, input: unknown): OptimizedAgentPayload {
  const config = AGENT_CONFIGS[agentName];
  const compressedInput = compressInput(input, config.maxInputTokens);
  const compactInput = JSON.stringify(compressedInput);
  const finalInput = estimateTokens(compactInput) > config.maxInputTokens
    ? compactInput.slice(0, config.maxInputTokens * 4)
    : compactInput;

  return {
    optimizedInput: compressedInput,
    systemPrompt: `You are the ${agentName} agent for StackForge. ${AGENT_REQUIREMENTS[agentName]} Never include markdown, code fences, or explanatory text.`,
    userPrompt: finalInput,
    model: config.model,
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: config.maxOutputTokens,
    temperature: config.temperature,
  };
}
