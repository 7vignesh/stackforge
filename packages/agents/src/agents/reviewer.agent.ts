import type { ReviewerInput, ReviewerOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { runAgent, type AgentRunHooks, type AgentRunResult } from "./base.agent.js";

export function runReviewerAgent(
  input: ReviewerInput,
  provider: LLMProvider,
  cache: AgentCache,
  hooks?: AgentRunHooks,
): Promise<AgentRunResult<ReviewerOutput>> {
  return runAgent<ReviewerInput, ReviewerOutput>("reviewer", input, provider, cache, hooks);
}
