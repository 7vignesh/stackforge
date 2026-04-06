import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "./provider.interface.js";
import { jsonrepair } from "jsonrepair";

export type OpenRouterProviderOptions = {
  apiKey: string;
  endpoint?: string;
  appName?: string;
  appUrl?: string;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  error?: {
    message?: string;
  };
};

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();

  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  const firstNewline = trimmed.indexOf("\n");
  if (firstNewline === -1) {
    return trimmed;
  }

  const closingFence = trimmed.indexOf("\n```", firstNewline + 1);
  if (closingFence === -1) {
    return trimmed.slice(firstNewline + 1).trim();
  }

  return trimmed.slice(firstNewline + 1, closingFence).trim();
}

function safeJsonParse(candidate: string): unknown | undefined {
  try {
    const parsed = JSON.parse(candidate);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function safeRepairedJsonParse(candidate: string): unknown | undefined {
  try {
    const parsed = JSON.parse(jsonrepair(candidate));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function findBalancedJsonEnd(text: string, startIndex: number): number {
  const opening = text[startIndex];
  if (opening !== "{" && opening !== "[") {
    return -1;
  }

  const stack: string[] = [opening];
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex + 1; i < text.length; i++) {
    const char = text[i]!;

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      const lastOpening = stack[stack.length - 1];
      const isMatchingPair = (lastOpening === "{" && char === "}")
        || (lastOpening === "[" && char === "]");

      if (!isMatchingPair) {
        return -1;
      }

      stack.pop();
      if (stack.length === 0) {
        return i;
      }
    }
  }

  return -1;
}

function collectJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  let startsScanned = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char !== "{" && char !== "[") {
      continue;
    }

    startsScanned += 1;
    if (startsScanned > 12) {
      break;
    }

    const endIndex = findBalancedJsonEnd(text, i);
    const candidate = endIndex > -1
      ? text.slice(i, endIndex + 1).trim()
      : text.slice(i).trim();

    if (candidate.length < 2 || seen.has(candidate)) {
      continue;
    }

    candidates.push(candidate);
    seen.add(candidate);
  }

  return candidates;
}

function repairTruncatedJson(incomplete: string): string {
  const trimmed = incomplete.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const openings: string[] = [];
  let inString = false;
  let escapeNext = false;
  let lastValidIndex = -1;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i]!;

    if (escapeNext) {
      escapeNext = false;
      lastValidIndex = i;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      lastValidIndex = i;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      lastValidIndex = i;
      continue;
    }

    if (inString) {
      lastValidIndex = i;
      continue;
    }

    if (char === "{" || char === "[") {
      openings.push(char);
      lastValidIndex = i;
    } else if (char === "}" || char === "]") {
      const expectedOpening = char === "}" ? "{" : "[";
      if (openings[openings.length - 1] === expectedOpening) {
        openings.pop();
        lastValidIndex = i;
      } else {
        break;
      }
    } else if (char === ":" || char === "," || /[0-9a-zA-Z._-]/.test(char)) {
      lastValidIndex = i;
    } else if (char === " " || char === "\n" || char === "\t" || char === "\r") {
      if (lastValidIndex > -1) {
        lastValidIndex = i;
      }
    } else {
      break;
    }
  }

  let repaired = lastValidIndex > -1 ? trimmed.substring(0, lastValidIndex + 1) : trimmed;

  if (inString && !repaired.endsWith('"')) {
    repaired += '"';
  }

  while (openings.length > 0) {
    const lastChar = repaired.trim().slice(-1) || "";
    if (lastChar === ",") {
      repaired = repaired.slice(0, -1);
    }
    const open = openings.pop();
    repaired += open === "{" ? "}" : "]";
  }

  return repaired.trim();
}

function parseJsonContent(content: string): unknown {
  const cleaned = stripCodeFences(content).replace(/^\uFEFF/, "").trim();
  if (cleaned.length === 0) {
    throw new Error("Model returned empty content");
  }
  
  // Try direct parse first
  const direct = safeJsonParse(cleaned);
  if (direct !== undefined) {
    return direct;
  }

  const directRepaired = safeRepairedJsonParse(cleaned);
  if (directRepaired !== undefined) {
    return directRepaired;
  }

  const candidates = collectJsonCandidates(cleaned);
  for (const candidate of candidates) {
    const parsed = safeJsonParse(candidate);
    if (parsed !== undefined) {
      return parsed;
    }

    const repairedParsed = safeRepairedJsonParse(candidate);
    if (repairedParsed !== undefined) {
      return repairedParsed;
    }
  }

  // Strategy 1: Repair truncated/unclosed structure
  const repaired = repairTruncatedJson(cleaned);
  const truncatedParsed = safeJsonParse(repaired);
  if (truncatedParsed !== undefined) {
    return truncatedParsed;
  }

  const truncatedRepairedParsed = safeRepairedJsonParse(repaired);
  if (truncatedRepairedParsed !== undefined) {
    return truncatedRepairedParsed;
  }

  for (const candidate of candidates) {
    const repairedCandidate = repairTruncatedJson(candidate);
    const parsed = safeJsonParse(repairedCandidate);
    if (parsed !== undefined) {
      return parsed;
    }

    const repairedParsed = safeRepairedJsonParse(repairedCandidate);
    if (repairedParsed !== undefined) {
      return repairedParsed;
    }
  }

  throw new Error("Failed to parse or recover JSON structure");
}

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly appName: string;
  private readonly appUrl: string;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";
    this.appName = options.appName ?? "stackforge";
    this.appUrl = options.appUrl ?? "http://localhost";
  }

  async call({ options }: ProviderCallInput): Promise<ProviderCallOutput> {
    const startedAt = Date.now();

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.appUrl,
        "X-Title": this.appName,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.userPrompt },
        ],
        max_tokens: options.maxOutputTokens,
        temperature: options.temperature,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter request failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (data.error?.message !== undefined) {
      throw new Error(`OpenRouter error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (content === undefined || content.length === 0) {
      throw new Error("OpenRouter response did not include message content");
    }

    let output: unknown;
    try {
      output = parseJsonContent(content);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenRouter returned non-JSON content: ${msg}`);
    }

    const inputTokens = data.usage?.prompt_tokens;
    const outputTokens = data.usage?.completion_tokens;
    const totalTokens = data.usage?.total_tokens
      ?? (inputTokens ?? 0) + (outputTokens ?? 0);

    return {
      output,
      tokensUsed: totalTokens,
      durationMs: Date.now() - startedAt,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      model: data.model ?? options.model,
    };
  }
}
