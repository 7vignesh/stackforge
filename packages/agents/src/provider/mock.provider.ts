import type { AgentName } from "@stackforge/shared";
import type { LLMProvider, ProviderCallInput, ProviderCallOutput } from "./provider.interface.js";
import {
  buildPlannerOutput,
  buildSchemaOutput,
  buildApiOutput,
  buildFrontendOutput,
  buildDevopsOutput,
  buildReviewerOutput,
} from "./mock.data.js";

const SIMULATED_TOKENS: Record<AgentName, number> = {
  planner: 620,
  schema: 1180,
  api: 940,
  frontend: 870,
  devops: 590,
  reviewer: 710,
};

const SIMULATED_DELAY_MS: Record<AgentName, [number, number]> = {
  planner: [120, 280],
  schema: [200, 420],
  api: [180, 360],
  frontend: [160, 320],
  devops: [100, 220],
  reviewer: [140, 300],
};

function extractProjectName(input: unknown): string {
  if (
    input !== null &&
    typeof input === "object" &&
    "projectName" in input &&
    typeof (input as Record<string, unknown>)["projectName"] === "string"
  ) {
    return (input as Record<string, unknown>)["projectName"] as string;
  }
  return "myapp";
}

function simulate(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dispatch(agentName: AgentName, input: unknown): unknown {
  const projectName = extractProjectName(input);
  switch (agentName) {
    case "planner":  return buildPlannerOutput(projectName);
    case "schema":   return buildSchemaOutput();
    case "api":      return buildApiOutput();
    case "frontend": return buildFrontendOutput();
    case "devops":   return buildDevopsOutput(projectName);
    case "reviewer": return buildReviewerOutput();
  }
}

export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async call({ agentName, input, options, onToken }: ProviderCallInput): Promise<ProviderCallOutput> {
    const [min, max] = SIMULATED_DELAY_MS[agentName];
    const start = Date.now();
    const output = dispatch(agentName, input);

    const streamText = JSON.stringify(output, null, 2);
    const chunkSize = 18;
    for (let i = 0; i < streamText.length; i += chunkSize) {
      onToken?.(streamText.slice(i, i + chunkSize));
      await simulate(12, 24);
    }

    await simulate(min, max);
    const durationMs = Date.now() - start;

    const inputTokens = Math.ceil(options.userPrompt.length / 4);
    const outputTokens = SIMULATED_TOKENS[agentName];

    return {
      output,
      tokensUsed: inputTokens + outputTokens,
      durationMs,
      inputTokens,
      outputTokens,
      model: options.model,
    };
  }
}
