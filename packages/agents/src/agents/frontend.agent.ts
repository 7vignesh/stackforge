import type { FrontendInput, FrontendOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { runAgent, type AgentRunHooks, type AgentRunResult } from "./base.agent.js";

export function runFrontendAgent(
  input: FrontendInput,
  provider: LLMProvider,
  cache: AgentCache,
  hooks?: AgentRunHooks,
): Promise<AgentRunResult<FrontendOutput>> {
  return runAgent<FrontendInput, FrontendOutput>("frontend", input, provider, cache, hooks);
}
