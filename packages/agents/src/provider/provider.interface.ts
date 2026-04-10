import type { AgentName } from "@stackforge/shared";

export type ProviderCallOptions = {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  temperature: number;
};

export type ProviderCallInput = {
  agentName: AgentName;
  input: unknown;
  options: ProviderCallOptions;
  onToken?: (chunk: string) => void;
};

export type ProviderCallOutput = {
  output: unknown;
  tokensUsed: number;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
};

export interface LLMProvider {
  readonly name: string;
  call(input: ProviderCallInput): Promise<ProviderCallOutput>;
}
