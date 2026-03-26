import type { AgentName } from "@stackforge/shared";
import { AGENT_CONFIGS } from "../config/agent.configs.js";
import { buildAgentPrompt } from "../agents/prompts/index.js";

export type OptimizedAgentPayload = {
  optimizedInput: unknown;
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
  estimatedInputTokens: number;
  compressionPasses: number;
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

type CompressionPlan = {
  promptRatio: number;
  genericStringRatio: number;
  arrayLimit: number;
};

function buildCompressionPlan(
  level: "low" | "medium" | "high",
  pass: number,
): CompressionPlan {
  const presets: Record<"low" | "medium" | "high", CompressionPlan> = {
    low: { promptRatio: 0.9, genericStringRatio: 0.8, arrayLimit: 24 },
    medium: { promptRatio: 0.75, genericStringRatio: 0.6, arrayLimit: 16 },
    high: { promptRatio: 0.6, genericStringRatio: 0.4, arrayLimit: 10 },
  };

  const base = presets[level];
  const adjustment = pass * 0.12;
  return {
    promptRatio: Math.max(0.2, base.promptRatio - adjustment),
    genericStringRatio: Math.max(0.15, base.genericStringRatio - adjustment),
    arrayLimit: Math.max(3, base.arrayLimit - pass * 4),
  };
}

function clampJsonSize(serialized: string, maxInputTokens: number): string {
  const maxChars = maxInputTokens * 4;
  return serialized.length <= maxChars ? serialized : serialized.slice(0, maxChars);
}

function compressLargeCollections(
  value: Record<string, unknown>,
  arrayLimit: number,
): Record<string, unknown> {
  const keys = [
    "entities",
    "relationships",
    "routePlan",
    "frontendPages",
    "generatedFilesPlan",
    "folderStructure",
    "reviewerNotes",
    "ci",
    "deployment",
    "envVars",
  ];

  const copy = { ...value };
  for (const key of keys) {
    const current = copy[key];
    if (Array.isArray(current) && current.length > arrayLimit) {
      copy[key] = current.slice(0, arrayLimit);
    }
  }

  return copy;
}

function compressInput(input: unknown, maxInputTokens: number, plan: CompressionPlan): unknown {
  const maxChars = maxInputTokens * 4;

  if (input === null || typeof input !== "object") {
    return trimPromptValue(input, maxChars);
  }

  let shallow = { ...(input as Record<string, unknown>) };
  shallow = compressLargeCollections(shallow, plan.arrayLimit);

  if ("prompt" in shallow) {
    shallow["prompt"] = trimPromptValue(shallow["prompt"], Math.floor(maxChars * plan.promptRatio));
  }

  for (const [key, value] of Object.entries(shallow)) {
    if (key !== "prompt") {
      shallow[key] = trimPromptValue(value, Math.floor(maxChars * plan.genericStringRatio));
    }
  }

  let serialized = JSON.stringify(shallow);
  if (serialized.length <= maxChars) {
    return shallow;
  }

  if ("prompt" in shallow) {
    const prompt = shallow["prompt"];
    if (typeof prompt === "string") {
      shallow["prompt"] = trimPromptValue(prompt, Math.floor(maxChars * Math.max(0.2, plan.promptRatio - 0.2)));
    }
  }

  serialized = JSON.stringify(shallow);
  if (serialized.length <= maxChars) {
    return shallow;
  }

  return { prompt: clampJsonSize(serialized, maxInputTokens) };
}

export function optimizeAgentPayload(agentName: AgentName, input: unknown): OptimizedAgentPayload {
  const config = AGENT_CONFIGS[agentName];
  const attempts = Math.max(1, config.budgetOverflowRetries + 1);

  let selectedInput: unknown = input;
  let selectedPrompt = JSON.stringify(input);
  let estimatedInputTokens = estimateTokens(selectedPrompt);
  let selectedPass = 1;

  for (let pass = 0; pass < attempts; pass++) {
    const plan = buildCompressionPlan(config.compressionLevel, pass);
    const compressedInput = compressInput(input, config.maxInputTokens, plan);
    const compactInput = clampJsonSize(JSON.stringify(compressedInput), config.maxInputTokens);
    const tokenEstimate = estimateTokens(compactInput);

    selectedInput = compressedInput;
    selectedPrompt = compactInput;
    estimatedInputTokens = tokenEstimate;
    selectedPass = pass + 1;

    if (tokenEstimate <= config.maxInputTokens) {
      break;
    }
  }

  if (estimatedInputTokens > config.maxInputTokens) {
    throw new Error(
      `Token budget exceeded for agent '${agentName}' after ${attempts} compression attempts`,
    );
  }

  const remainingBudget = config.tokenBudget - estimatedInputTokens;
  if (remainingBudget < config.minOutputTokens) {
    throw new Error(
      `Insufficient output token budget for agent '${agentName}' after compression`,
    );
  }

  const cappedOutputTokens = Math.min(config.maxOutputTokens, remainingBudget);

  const prompt = buildAgentPrompt(agentName, selectedInput);

  return {
    optimizedInput: selectedInput,
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
    model: config.model,
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: cappedOutputTokens,
    temperature: config.temperature,
    estimatedInputTokens,
    compressionPasses: selectedPass,
  };
}
