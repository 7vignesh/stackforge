import type { DevopsInput, DevopsOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { runAgent, type AgentRunResult } from "./base.agent.js";

export function runDevopsAgent(
  input: DevopsInput,
  provider: LLMProvider,
  cache: AgentCache,
): Promise<AgentRunResult<DevopsOutput>> {
  return runAgent<DevopsInput, DevopsOutput>("devops", input, provider, cache);
}
