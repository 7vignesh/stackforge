/// <reference types="bun" />
import { afterEach, describe, expect, it } from "bun:test";
import { NvidiaProvider } from "../src/provider/nvidia.provider.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("NvidiaProvider", () => {
  it("uses NVIDIA auth header and forces configured model", async () => {
    let observedAuthorization = "";
    let observedModel = "";

    globalThis.fetch = async (_input, init) => {
      const headers = init?.headers;
      if (headers !== undefined && !Array.isArray(headers) && !(headers instanceof Headers)) {
        observedAuthorization = String(headers["Authorization"] ?? "");
      }

      const parsedBody = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      observedModel = parsedBody.model ?? "";

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          model: "moonshotai/kimi-k2-instruct",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new NvidiaProvider({
      apiKey: "nvidia-key",
      model: "moonshotai/kimi-k2-instruct",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    });

    const result = await provider.call({
      agentName: "codegen",
      input: { prompt: "build app" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 500,
        maxOutputTokens: 500,
        temperature: 0.1,
      },
    });

    expect(observedAuthorization).toBe("Bearer nvidia-key");
    expect(observedModel).toBe("moonshotai/kimi-k2-instruct");
    expect(result.output).toEqual({ ok: true });
    expect(result.tokensUsed).toBe(30);
  });

  it("falls back to next API key when the first key is rate limited", async () => {
    const observedAuthorizations: string[] = [];
    let callCount = 0;

    globalThis.fetch = async (_input, init) => {
      const headers = init?.headers;
      if (headers !== undefined && !Array.isArray(headers) && !(headers instanceof Headers)) {
        observedAuthorizations.push(String(headers["Authorization"] ?? ""));
      }

      callCount += 1;
      if (callCount === 1) {
        return new Response(
          JSON.stringify({ error: { message: "rate limit exceeded" } }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          model: "moonshotai/kimi-k2.5",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new NvidiaProvider({
      apiKeys: ["nvidia-key-1", "nvidia-key-2", "nvidia-key-3"],
      model: "moonshotai/kimi-k2.5",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    });

    const result = await provider.call({
      agentName: "codegen",
      input: { prompt: "build app" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 500,
        maxOutputTokens: 500,
        temperature: 0.1,
      },
    });

    expect(observedAuthorizations).toEqual([
      "Bearer nvidia-key-1",
      "Bearer nvidia-key-2",
    ]);
    expect(result.output).toEqual({ ok: true });
    expect(result.tokensUsed).toBe(7);
  });
});
