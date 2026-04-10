import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "./provider.interface.js";
import { jsonrepair } from "jsonrepair";

export type OpenRouterProviderOptions = {
  apiKey?: string;
  apiKeys?: string[];
  endpoint?: string;
  appName?: string;
  appUrl?: string;
  requestTimeoutMs?: number;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
    delta?: {
      content?: unknown;
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

class OpenRouterRequestError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "OpenRouterRequestError";
    this.statusCode = statusCode;
  }
}

function normalizeApiKeys(options: OpenRouterProviderOptions): string[] {
  const keys = [
    ...(Array.isArray(options.apiKeys) ? options.apiKeys : []),
    ...(options.apiKey !== undefined ? [options.apiKey] : []),
  ]
    .map((key) => key.trim())
    .filter((key) => key.length > 0);

  const unique = [...new Set(keys)];
  if (unique.length === 0) {
    throw new Error("OpenRouterProvider requires at least one API key");
  }

  return unique;
}

function isRetryableOpenRouterError(error: unknown): boolean {
  if (error instanceof OpenRouterRequestError) {
    const status = error.statusCode;
    if (status !== undefined && (status === 401 || status === 403 || status === 408 || status === 409 || status === 429 || status >= 500)) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /rate\s*limit|too\s*many\s*requests|quota|temporar|timeout|unavailable|overload|capacity/.test(message);
}

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

function ensureJsonKeyword(prompt: string): string {
  if (/\bjson\b/i.test(prompt)) {
    return prompt;
  }

  return `${prompt}\n\nReturn a valid json object.`;
}

function streamContentToText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((part) => streamContentToText(part))
      .join("");
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record["text"] === "string") {
      return record["text"];
    }
    if (typeof record["content"] === "string") {
      return record["content"];
    }
  }

  return "";
}

function toProviderOutput(
  data: OpenRouterResponse,
  fallbackModel: string,
  startedAt: number,
): ProviderCallOutput {
  if (data.error?.message !== undefined) {
    throw new OpenRouterRequestError(`OpenRouter error: ${data.error.message}`);
  }

  const content = streamContentToText(data.choices?.[0]?.message?.content);
  if (content.length === 0) {
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
    model: data.model ?? fallbackModel,
  };
}

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";
  private readonly apiKeys: string[];
  private readonly endpoint: string;
  private readonly appName: string;
  private readonly appUrl: string;
  private readonly requestTimeoutMs: number;
  private nextApiKeyIndex = 0;

  constructor(options: OpenRouterProviderOptions) {
    this.apiKeys = normalizeApiKeys(options);
    this.endpoint = options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";
    this.appName = options.appName ?? "stackforge";
    this.appUrl = options.appUrl ?? "http://localhost";
    this.requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? 90_000);
  }

  private consumeStartKeyIndex(): number {
    const index = this.nextApiKeyIndex;
    this.nextApiKeyIndex = (this.nextApiKeyIndex + 1) % this.apiKeys.length;
    return index;
  }

  private async callNonStreamingWithApiKey(
    apiKey: string,
    payload: {
      model: string;
      systemPrompt: string;
      userPrompt: string;
      maxOutputTokens: number;
      temperature: number;
    },
    startedAt: number,
    signal: AbortSignal,
  ): Promise<ProviderCallOutput> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": this.appUrl,
        "X-Title": this.appName,
      },
      body: JSON.stringify({
        model: payload.model,
        messages: [
          { role: "system", content: payload.systemPrompt },
          { role: "user", content: payload.userPrompt },
        ],
        max_tokens: payload.maxOutputTokens,
        temperature: payload.temperature,
        response_format: { type: "json_object" },
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new OpenRouterRequestError(
        `OpenRouter request failed (${response.status}): ${errorBody}`,
        response.status,
      );
    }

    const data = (await response.json()) as OpenRouterResponse;
    return toProviderOutput(data, payload.model, startedAt);
  }

  private async callWithApiKey(apiKey: string, { options, onToken }: ProviderCallInput): Promise<ProviderCallOutput> {
    const startedAt = Date.now();
    const systemPrompt = ensureJsonKeyword(options.systemPrompt);
    const userPrompt = ensureJsonKeyword(options.userPrompt);

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.requestTimeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": this.appUrl,
          "X-Title": this.appName,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: options.maxOutputTokens,
          temperature: options.temperature,
          response_format: { type: "json_object" },
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new OpenRouterRequestError(`OpenRouter request failed (${response.status}): ${errorBody}`, response.status);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const isJsonResponse = contentType.includes("application/json");
      const isSseResponse = contentType.includes("text/event-stream");

      if (isJsonResponse && !isSseResponse) {
        const data = (await response.json()) as OpenRouterResponse;
        return toProviderOutput(data, options.model, startedAt);
      }

      if (response.body === null) {
        const data = (await response.json()) as OpenRouterResponse;
        return toProviderOutput(data, options.model, startedAt);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedContent = "";
      let usage: OpenRouterResponse["usage"];
      let responseModel: string | undefined;

      const processChunk = (raw: string): void => {
      const lines = raw.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const payload = trimmed.slice(5).trim();
        if (payload.length === 0 || payload === "[DONE]") {
          continue;
        }

        let parsed: OpenRouterResponse;

        try {
          parsed = JSON.parse(payload) as OpenRouterResponse;
        } catch {
          continue;
        }

        if (parsed.error?.message !== undefined) {
          throw new OpenRouterRequestError(`OpenRouter error: ${parsed.error.message}`);
        }

        if (parsed.usage !== undefined) {
          usage = parsed.usage;
        }

        if (parsed.model !== undefined) {
          responseModel = parsed.model;
        }

        const tokenChunk = streamContentToText(parsed.choices?.[0]?.delta?.content)
          || streamContentToText(parsed.choices?.[0]?.message?.content);
        if (tokenChunk.length > 0) {
          streamedContent += tokenChunk;
          onToken?.(tokenChunk);
        }
      }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const eventChunk of events) {
          processChunk(eventChunk);
        }
      }

      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        processChunk(buffer);
      }

      const content = streamedContent.trim();
      if (content.length === 0) {
        return await this.callNonStreamingWithApiKey(
          apiKey,
          {
            model: options.model,
            systemPrompt,
            userPrompt,
            maxOutputTokens: options.maxOutputTokens,
            temperature: options.temperature,
          },
          startedAt,
          abortController.signal,
        );
      }

      let output: unknown;
      try {
        output = parseJsonContent(content);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`OpenRouter returned non-JSON content: ${msg}`);
      }

      const inputTokens = usage?.prompt_tokens;
      const outputTokens = usage?.completion_tokens;
      const totalTokens = usage?.total_tokens
        ?? (inputTokens ?? 0) + (outputTokens ?? 0);

      return {
        output,
        tokensUsed: totalTokens,
        durationMs: Date.now() - startedAt,
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        model: responseModel ?? options.model,
      };
    } catch (error) {
      const errorName = error !== null && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name)
        : "";

      if (errorName === "AbortError") {
        throw new OpenRouterRequestError(
          `OpenRouter request timed out after ${this.requestTimeoutMs}ms`,
          408,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async call(input: ProviderCallInput): Promise<ProviderCallOutput> {
    const startIndex = this.consumeStartKeyIndex();
    let lastError: unknown;

    for (let attempt = 0; attempt < this.apiKeys.length; attempt += 1) {
      const keyIndex = (startIndex + attempt) % this.apiKeys.length;
      const key = this.apiKeys[keyIndex]!;
      let streamedAnyToken = false;

      const guardedOnToken = input.onToken === undefined
        ? undefined
        : (chunk: string): void => {
            streamedAnyToken = true;
            input.onToken?.(chunk);
          };

      try {
        return await this.callWithApiKey(key, {
          ...input,
          ...(guardedOnToken !== undefined ? { onToken: guardedOnToken } : {}),
        });
      } catch (error) {
        lastError = error;

        const isLastAttempt = attempt >= this.apiKeys.length - 1;
        const canRetry = !streamedAnyToken && !isLastAttempt && isRetryableOpenRouterError(error);
        if (!canRetry) {
          throw error;
        }
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new Error("OpenRouter request failed for all configured API keys");
  }
}
