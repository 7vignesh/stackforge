import type { AgentName } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";

export type AgentRunResult<T> = {
  agentName: AgentName;
  output: T;
  cached: boolean;
  durationMs: number;
  tokensUsed: number;
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
    };
  }

  const start = Date.now();
  const response = await provider.call({ agentName, input });
  const durationMs = Date.now() - start;

  cache.set(cacheKey, response.output);

  return {
    agentName,
    output: response.output as TOutput,
    cached: false,
    durationMs,
    tokensUsed: response.tokensUsed,
  };
}
