import type { DevopsInput, DevopsOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import {
  runAgent,
  type AgentRunHooks,
  type AgentRunResult,
  type AgentRuntimeControls,
} from "./base.agent.js";

export function runDevopsAgent(
  input: DevopsInput,
  provider: LLMProvider,
  cache: AgentCache,
  hooks?: AgentRunHooks,
  runtimeControls?: AgentRuntimeControls,
): Promise<AgentRunResult<DevopsOutput>> {
  return runAgent<DevopsInput, DevopsOutput>(
    "devops",
    input,
    provider,
    cache,
    hooks,
    runtimeControls,
  );
}
