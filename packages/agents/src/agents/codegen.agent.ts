import type { CodegenInput, CodegenOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import {
  runAgent,
  type AgentRunHooks,
  type AgentRunResult,
  type AgentRuntimeControls,
} from "./base.agent.js";

export function runCodegenAgent(
  input: CodegenInput,
  provider: LLMProvider,
  cache: AgentCache,
  hooks?: AgentRunHooks,
  runtimeControls?: AgentRuntimeControls,
): Promise<AgentRunResult<CodegenOutput>> {
  return runAgent<CodegenInput, CodegenOutput>(
    "codegen",
    input,
    provider,
    cache,
    hooks,
    runtimeControls,
  );
}
