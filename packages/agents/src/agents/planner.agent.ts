import type { PlannerInput, PlannerOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { runAgent, type AgentRunResult } from "./base.agent.js";

export function runPlannerAgent(
  input: PlannerInput,
  provider: LLMProvider,
  cache: AgentCache,
): Promise<AgentRunResult<PlannerOutput>> {
  return runAgent<PlannerInput, PlannerOutput>("planner", input, provider, cache);
}
