import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "./provider.interface.js";

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

  const lines = trimmed.split("\n");
  const body = lines.slice(1, -1).join("\n");
  return body.trim();
}

function parseJsonContent(content: string): unknown {
  const cleaned = stripCodeFences(content);
  return JSON.parse(cleaned);
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
