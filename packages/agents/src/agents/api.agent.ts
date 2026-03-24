import type { ApiAgentInput, ApiAgentOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { runAgent, type AgentRunResult } from "./base.agent.js";

export function runApiAgent(
  input: ApiAgentInput,
  provider: LLMProvider,
  cache: AgentCache,
): Promise<AgentRunResult<ApiAgentOutput>> {
  return runAgent<ApiAgentInput, ApiAgentOutput>("api", input, provider, cache);
}
