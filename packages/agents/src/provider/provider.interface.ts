import type { AgentName } from "@stackforge/shared";

export type ProviderCallInput = {
  agentName: AgentName;
  input: unknown;
};

export type ProviderCallOutput = {
  output: unknown;
  tokensUsed: number;
  durationMs: number;
};

export interface LLMProvider {
  readonly name: string;
  call(input: ProviderCallInput): Promise<ProviderCallOutput>;
}
