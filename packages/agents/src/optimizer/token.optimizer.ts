import type { AgentName } from "@stackforge/shared";
import { encodingForModel, getEncoding, type TiktokenModel, type Tiktoken } from "js-tiktoken";
import { AGENT_CONFIGS } from "../config/agent.configs.js";
import { buildAgentPrompt, extractAgentContext } from "../agents/prompts/index.js";

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

export type RuntimeTokenConstraints = {
  tokenBudgetLimit?: number;
  maxOutputTokensLimit?: number;
};

const tokenizerCache = new Map<string, Tiktoken>();

function normalizeModel(model: string): string {
  const providerStripped = model.includes("/") ? model.split("/").at(-1) ?? model : model;
  return providerStripped.split(":")[0]?.trim() ?? providerStripped;
}

function getTokenizer(model: string): Tiktoken {
  const normalized = normalizeModel(model);
  const cached = tokenizerCache.get(normalized);
  if (cached !== undefined) {
    return cached;
  }

  let tokenizer: Tiktoken;
  try {
    tokenizer = encodingForModel(normalized as TiktokenModel);
  } catch {
    tokenizer = getEncoding("o200k_base");
  }

  tokenizerCache.set(normalized, tokenizer);
  return tokenizer;
}

function estimateTextTokens(text: string, model: string): number {
  return getTokenizer(model).encode(text).length;
}

function estimatePromptTokens(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  inputLimit?: number,
): number {
  const roughEstimate = Math.ceil((systemPrompt.length + userPrompt.length) / 3.7) + 20;

  if (inputLimit !== undefined && roughEstimate > inputLimit * 1.5) {
    return roughEstimate;
  }

  const systemTokens = estimateTextTokens(systemPrompt, model);
  const userTokens = estimateTextTokens(userPrompt, model);

  // Account for chat message wrappers and small protocol overhead.
  return systemTokens + userTokens + 20;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimPromptValue(value: unknown, maxChars: number): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = normalizeWhitespace(value);

  if (normalized.length <= maxChars) {
    return normalized;
  }

  if (maxChars <= 48) {
    return normalized.slice(0, maxChars);
  }

  const head = Math.floor(maxChars * 0.72);
  const tail = Math.max(12, maxChars - head - 5);
  return `${normalized.slice(0, head)} ... ${normalized.slice(-tail)}`;
}

type CompressionPlan = {
  promptChars: number;
  genericStringChars: number;
  arrayLimit: number;
  objectKeyLimit: number;
  maxDepth: number;
};

function buildCompressionPlan(
  level: "low" | "medium" | "high",
  pass: number,
  maxInputTokens: number,
): CompressionPlan {
  const maxChars = maxInputTokens * 4;

  const presets: Record<"low" | "medium" | "high", CompressionPlan> = {
    low: {
      promptChars: Math.floor(maxChars * 0.65),
      genericStringChars: Math.floor(maxChars * 0.24),
      arrayLimit: 28,
      objectKeyLimit: 18,
      maxDepth: 6,
    },
    medium: {
      promptChars: Math.floor(maxChars * 0.52),
      genericStringChars: Math.floor(maxChars * 0.18),
      arrayLimit: 18,
      objectKeyLimit: 14,
      maxDepth: 5,
    },
    high: {
      promptChars: Math.floor(maxChars * 0.42),
      genericStringChars: Math.floor(maxChars * 0.13),
      arrayLimit: 12,
      objectKeyLimit: 10,
      maxDepth: 4,
    },
  };

  const base = presets[level];
  const scalar = Math.max(0.25, 1 - pass * 0.2);

  return {
    promptChars: Math.max(80, Math.floor(base.promptChars * scalar)),
    genericStringChars: Math.max(48, Math.floor(base.genericStringChars * scalar)),
    arrayLimit: Math.max(3, base.arrayLimit - pass * 4),
    objectKeyLimit: Math.max(4, base.objectKeyLimit - pass * 2),
    maxDepth: Math.max(2, base.maxDepth - pass),
  };
}

const KEY_PRIORITY: Record<string, number> = {
  prompt: 100,
  projectName: 98,
  stack: 96,
  entities: 95,
  relationships: 95,
  routePlan: 94,
  frontendPages: 93,
  infraPlan: 92,
  generatedFilesPlan: 92,
  reviewerNotes: 92,
  generatedSourceFiles: 92,
  content: 88,
  language: 84,
  name: 90,
  tableName: 88,
  fields: 88,
  method: 87,
  path: 87,
  type: 86,
  description: 85,
  auth: 84,
  responseType: 84,
};

function keyScore(key: string): number {
  if (key in KEY_PRIORITY) {
    return KEY_PRIORITY[key] ?? 0;
  }

  if (key.endsWith("Id") || key === "id") {
    return 70;
  }

  return 30;
}

function sampleArray<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) {
    return values;
  }

  if (limit <= 1) {
    return [values[0]!];
  }

  const sampled: T[] = [];
  const step = (values.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index++) {
    sampled.push(values[Math.round(index * step)]!);
  }

  return sampled;
}

function compressRecursive(
  value: unknown,
  plan: CompressionPlan,
  key: string,
  depth: number,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return trimPromptValue(
      value,
      key === "prompt" ? plan.promptChars : plan.genericStringChars,
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    const sampled = sampleArray(value, plan.arrayLimit);
    return sampled.map((item) => compressRecursive(item, plan, key, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= plan.maxDepth) {
      return "[truncated]";
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .sort((a, b) => keyScore(b[0]) - keyScore(a[0]))
      .slice(0, plan.objectKeyLimit);

    const out: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of entries) {
      out[entryKey] = compressRecursive(entryValue, plan, entryKey, depth + 1);
    }

    return out;
  }

  return value;
}

function compressInput(input: unknown, maxInputTokens: number, plan: CompressionPlan): unknown {
  return compressRecursive(input, plan, "", 0);
}

function buildMinimalContext(context: unknown, maxInputTokens: number): unknown {
  if (context === null || typeof context !== "object") {
    return trimPromptValue(context, maxInputTokens * 4);
  }

  const source = context as Record<string, unknown>;
  const minimal: Record<string, unknown> = {};

  if ("projectName" in source) {
    minimal["projectName"] = trimPromptValue(source["projectName"], 80);
  }

  if ("stack" in source) {
    minimal["stack"] = source["stack"];
  }

  if ("prompt" in source) {
    minimal["prompt"] = trimPromptValue(source["prompt"], Math.floor(maxInputTokens * 3.2));
  }

  return minimal;
}

function normalizePositiveInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

export function optimizeAgentPayload(
  agentName: AgentName,
  input: unknown,
  constraints?: RuntimeTokenConstraints,
): OptimizedAgentPayload {
  const config = AGENT_CONFIGS[agentName];
  const attempts = Math.max(1, config.budgetOverflowRetries + 1);
  const effectiveInputLimit = Math.max(64, config.maxInputTokens - 8);
  const runtimeTokenBudget = normalizePositiveInt(constraints?.tokenBudgetLimit);
  const effectiveTokenBudget = runtimeTokenBudget !== undefined
    ? Math.min(config.tokenBudget, runtimeTokenBudget)
    : config.tokenBudget;
  const runtimeOutputLimit = normalizePositiveInt(constraints?.maxOutputTokensLimit);
  const context = extractAgentContext(agentName, input);

  if (effectiveTokenBudget < config.minOutputTokens) {
    throw new Error(
      `Token budget too low for agent '${agentName}' (budget=${effectiveTokenBudget}, minOutput=${config.minOutputTokens})`,
    );
  }

  let selectedInput: unknown = context;
  let selectedPrompt = buildAgentPrompt(agentName, selectedInput);
  let estimatedInputTokens = estimatePromptTokens(
    selectedPrompt.systemPrompt,
    selectedPrompt.userPrompt,
    config.model,
    config.maxInputTokens,
  );
  let selectedPass = 1;

  for (let pass = 0; pass < attempts; pass++) {
    const plan = buildCompressionPlan(config.compressionLevel, pass, config.maxInputTokens);
    const compressedInput = compressInput(context, config.maxInputTokens, plan);
    const prompt = buildAgentPrompt(agentName, compressedInput);
    const tokenEstimate = estimatePromptTokens(
      prompt.systemPrompt,
      prompt.userPrompt,
      config.model,
      config.maxInputTokens,
    );

    selectedInput = compressedInput;
    selectedPrompt = prompt;
    estimatedInputTokens = tokenEstimate;
    selectedPass = pass + 1;

    if (tokenEstimate <= effectiveInputLimit) {
      break;
    }
  }

  if (estimatedInputTokens > effectiveInputLimit) {
    const minimal = buildMinimalContext(context, config.maxInputTokens);
    const prompt = buildAgentPrompt(agentName, minimal);
    const tokenEstimate = estimatePromptTokens(
      prompt.systemPrompt,
      prompt.userPrompt,
      config.model,
      config.maxInputTokens,
    );

    selectedInput = minimal;
    selectedPrompt = prompt;
    estimatedInputTokens = tokenEstimate;
    selectedPass = attempts + 1;
  }

  if (estimatedInputTokens > effectiveInputLimit) {
    throw new Error(
      `Token budget exceeded for agent '${agentName}' after ${attempts} compression attempts`,
    );
  }

  const remainingBudget = effectiveTokenBudget - estimatedInputTokens;
  if (remainingBudget < config.minOutputTokens) {
    throw new Error(
      `Insufficient output token budget for agent '${agentName}' after compression`,
    );
  }

  const cappedOutputTokens = Math.min(
    config.maxOutputTokens,
    remainingBudget,
    runtimeOutputLimit ?? Number.POSITIVE_INFINITY,
  );

  if (cappedOutputTokens < config.minOutputTokens) {
    throw new Error(
      `Insufficient capped output token budget for agent '${agentName}' after runtime limits`,
    );
  }

  return {
    optimizedInput: selectedInput,
    systemPrompt: selectedPrompt.systemPrompt,
    userPrompt: selectedPrompt.userPrompt,
    model: config.model,
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: cappedOutputTokens,
    temperature: config.temperature,
    estimatedInputTokens,
    compressionPasses: selectedPass,
  };
}
