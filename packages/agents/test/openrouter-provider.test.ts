/// <reference types="bun" />
import { afterEach, describe, expect, it } from "bun:test";
import { OpenRouterProvider } from "../src/provider/openrouter.provider.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenRouterProvider", () => {
  it("injects json keyword when prompts omit it", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = async (input, init) => {
      void input;
      const body = init?.body;
      const bodyText = typeof body === "string" ? body : "";
      capturedBody = JSON.parse(bodyText) as Record<string, unknown>;

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          model: "openai/gpt-4o-mini",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    await provider.call({
      agentName: "planner",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Produce output only",
        userPrompt: "plan app structure",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    const messages = Array.isArray(capturedBody?.["messages"])
      ? capturedBody?.["messages"] as Array<Record<string, unknown>>
      : [];

    const combinedMessageContent = messages
      .map((message) => String(message["content"] ?? ""))
      .join("\n")
      .toLowerCase();

    expect(combinedMessageContent.includes("json")).toBeTrue();
  });

  it("rotates API keys in round-robin order across calls", async () => {
    const usedAuthHeaders: string[] = [];

    globalThis.fetch = async (input, init) => {
      void input;
      const authorization =
        init?.headers !== undefined && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
          ? String(init.headers["Authorization"] ?? "")
          : "";

      usedAuthHeaders.push(authorization);

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          model: "openai/gpt-4o-mini",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new OpenRouterProvider({
      apiKeys: ["key-1", "key-2", "key-3"],
    });

    for (let i = 0; i < 4; i += 1) {
      await provider.call({
        agentName: "planner",
        input: { prompt: "build app", projectName: "acme" },
        options: {
          systemPrompt: "Return JSON",
          userPrompt: "{}",
          model: "openai/gpt-4o-mini",
          maxInputTokens: 300,
          maxOutputTokens: 300,
          temperature: 0.1,
        },
      });
    }

    expect(usedAuthHeaders).toEqual([
      "Bearer key-1",
      "Bearer key-2",
      "Bearer key-3",
      "Bearer key-1",
    ]);
  });

  it("fails over to next key when current key is rate-limited", async () => {
    const usedAuthHeaders: string[] = [];
    let callCount = 0;

    globalThis.fetch = async (input, init) => {
      void input;
      callCount += 1;
      const authorization =
        init?.headers !== undefined && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
          ? String(init.headers["Authorization"] ?? "")
          : "";

      usedAuthHeaders.push(authorization);

      if (callCount === 1) {
        return new Response("rate limit", {
          status: 429,
          headers: { "content-type": "text/plain" },
        });
      }

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          model: "openai/gpt-4o-mini",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new OpenRouterProvider({
      apiKeys: ["key-a", "key-b", "key-c"],
    });

    const result = await provider.call({
      agentName: "planner",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    expect(result.output).toEqual({ ok: true });
    expect(usedAuthHeaders).toEqual(["Bearer key-a", "Bearer key-b"]);
  });

  it("parses JSON response and exposes usage metrics", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"projectName":"acme"}' } }],
          usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
          model: "openai/gpt-4o-mini",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    const result = await provider.call({
      agentName: "planner",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{\"prompt\":\"build app\"}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    expect(result.output).toEqual({ projectName: "acme" });
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(80);
    expect(result.tokensUsed).toBe(200);
    expect(result.model).toBe("openai/gpt-4o-mini");
  });

  it("throws on non-JSON model content", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not-json" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    await expect(
      provider.call({
        agentName: "planner",
        input: { prompt: "build app", projectName: "acme" },
        options: {
          systemPrompt: "Return JSON",
          userPrompt: "{}",
          model: "openai/gpt-4o-mini",
          maxInputTokens: 300,
          maxOutputTokens: 300,
          temperature: 0.1,
        },
      }),
    ).rejects.toThrow("OpenRouter returned non-JSON content");
  });

  it("recovers malformed JSON with trailing commas", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: "{\"infra\":{\"docker\":{\"enabled\":true,\"services\":[\"api\",\"web\",],},},}",
            },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    const result = await provider.call({
      agentName: "devops",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    expect(result.output).toEqual({
      infra: {
        docker: {
          enabled: true,
          services: ["api", "web"],
        },
      },
    });
  });

  it("extracts JSON from fenced output with trailing text", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: [
                "```json",
                "{\"ciCd\":{\"provider\":\"github-actions\"}}",
                "```",
                "this explanatory suffix should be ignored",
              ].join("\n"),
            },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    const result = await provider.call({
      agentName: "devops",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    expect(result.output).toEqual({
      ciCd: {
        provider: "github-actions",
      },
    });
  });

  it("extracts balanced JSON when output has trailing garbage", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: "prefix text {\"deployment\":{\"target\":\"render\"}} ) trailing noise",
            },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    const result = await provider.call({
      agentName: "devops",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    expect(result.output).toEqual({
      deployment: {
        target: "render",
      },
    });
  });

  it("maps abort errors to timeout request errors", async () => {
    globalThis.fetch = async () => {
      const error = new Error("aborted");
      Object.assign(error, { name: "AbortError" });
      throw error;
    };

    const provider = new OpenRouterProvider({ apiKey: "test-key", requestTimeoutMs: 10 });

    await expect(
      provider.call({
        agentName: "planner",
        input: { prompt: "build app", projectName: "acme" },
        options: {
          systemPrompt: "Return JSON",
          userPrompt: "{}",
          model: "openai/gpt-4o-mini",
          maxInputTokens: 300,
          maxOutputTokens: 300,
          temperature: 0.1,
        },
      }),
    ).rejects.toThrow("timed out");
  });

  it("accepts streaming chunks that provide message.content", async () => {
    globalThis.fetch = async () =>
      new Response(
        [
          "data: {\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2},\"model\":\"openai/gpt-4o-mini\"}",
          "",
          "data: [DONE]",
          "",
        ].join("\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    const result = await provider.call({
      agentName: "codegen",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    expect(result.output).toEqual({ ok: true });
  });

  it("falls back to non-stream when streaming contains no content", async () => {
    let callCount = 0;

    globalThis.fetch = async (_input, init) => {
      callCount += 1;
      const bodyText = typeof init?.body === "string" ? init.body : "{}";
      const body = JSON.parse(bodyText) as { stream?: boolean };

      if (body.stream === true) {
        return new Response(
          [
            "data: {\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":0,\"total_tokens\":4},\"model\":\"openai/gpt-4o-mini\"}",
            "",
            "data: [DONE]",
            "",
          ].join("\n"),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }

      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{\"ok\":true}" } }],
          usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 },
          model: "openai/gpt-4o-mini",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const provider = new OpenRouterProvider({ apiKey: "test-key" });

    const result = await provider.call({
      agentName: "codegen",
      input: { prompt: "build app", projectName: "acme" },
      options: {
        systemPrompt: "Return JSON",
        userPrompt: "{}",
        model: "openai/gpt-4o-mini",
        maxInputTokens: 300,
        maxOutputTokens: 300,
        temperature: 0.1,
      },
    });

    expect(callCount).toBe(2);
    expect(result.output).toEqual({ ok: true });
    expect(result.tokensUsed).toBe(12);
  });
});
