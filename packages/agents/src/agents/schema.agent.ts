import type { SchemaInput, SchemaOutput } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import {
  runAgent,
  type AgentRunHooks,
  type AgentRunResult,
  type AgentRuntimeControls,
} from "./base.agent.js";

export function runSchemaAgent(
  input: SchemaInput,
  provider: LLMProvider,
  cache: AgentCache,
  hooks?: AgentRunHooks,
  runtimeControls?: AgentRuntimeControls,
): Promise<AgentRunResult<SchemaOutput>> {
  return runAgent<SchemaInput, SchemaOutput>(
    "schema",
    input,
    provider,
    cache,
    hooks,
    runtimeControls,
  );
}
