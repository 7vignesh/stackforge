import type { AgentName } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { optimizeAgentPayload } from "../optimizer/token.optimizer.js";
import { AgentOutputSchemas } from "./output.schemas.js";

export type AgentRunResult<T> = {
  agentName: AgentName;
  output: T;
  cached: boolean;
  durationMs: number;
  tokensUsed: number;
  estimatedInputTokens: number;
  compressionPasses: number;
  providerInputTokens: number;
  providerOutputTokens: number;
  model: string;
};

export async function runAgent<TInput, TOutput>(
  agentName: AgentName,
  input: TInput,
  provider: LLMProvider,
  cache: AgentCache,
): Promise<AgentRunResult<TOutput>> {
  const cacheKey = cache.hash({ agent: agentName, input });
  const cached = cache.get(cacheKey);

  if (cached !== undefined) {
    return {
      agentName,
      output: cached.output as TOutput,
      cached: true,
      durationMs: 0,
      tokensUsed: 0,
      estimatedInputTokens: 0,
      compressionPasses: 0,
      providerInputTokens: 0,
      providerOutputTokens: 0,
      model: "cache",
    };
  }

  const start = Date.now();
  const optimized = optimizeAgentPayload(agentName, input);
  const response = await provider.call({
    agentName,
    input: optimized.optimizedInput,
    options: {
      systemPrompt: optimized.systemPrompt,
      userPrompt: optimized.userPrompt,
      model: optimized.model,
      maxInputTokens: optimized.maxInputTokens,
      maxOutputTokens: optimized.maxOutputTokens,
      temperature: optimized.temperature,
    },
  });
  const durationMs = Date.now() - start;
  const schema = AgentOutputSchemas[agentName];
  const validatedOutput = schema.parse(response.output);

  cache.set(cacheKey, validatedOutput);

  return {
    agentName,
    output: validatedOutput as TOutput,
    cached: false,
    durationMs,
    tokensUsed: response.tokensUsed,
    estimatedInputTokens: optimized.estimatedInputTokens,
    compressionPasses: optimized.compressionPasses,
    providerInputTokens: response.inputTokens ?? optimized.estimatedInputTokens,
    providerOutputTokens: response.outputTokens ?? optimized.maxOutputTokens,
    model: response.model ?? optimized.model,
  };
}
