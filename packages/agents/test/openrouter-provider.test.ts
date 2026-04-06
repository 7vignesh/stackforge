/// <reference types="bun" />
import { afterEach, describe, expect, it } from "bun:test";
import { OpenRouterProvider } from "../src/provider/openrouter.provider.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenRouterProvider", () => {
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
});
