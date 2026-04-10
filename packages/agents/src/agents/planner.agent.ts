import type { PlannerInput, PlannerOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import {
  runAgent,
  type AgentRunHooks,
  type AgentRunResult,
  type AgentRuntimeControls,
} from "./base.agent.js";

export function runPlannerAgent(
  input: PlannerInput,
  provider: LLMProvider,
  cache: AgentCache,
  hooks?: AgentRunHooks,
  runtimeControls?: AgentRuntimeControls,
): Promise<AgentRunResult<PlannerOutput>> {
  return runAgent<PlannerInput, PlannerOutput>(
    "planner",
    input,
    provider,
    cache,
    hooks,
    runtimeControls,
  );
}
