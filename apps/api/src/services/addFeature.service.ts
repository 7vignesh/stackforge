import type { Blueprint } from "@stackforge/shared";
import type { LLMProvider } from "@stackforge/agents";
import {
  AgentCache,
  runApiAgent,
  runDevopsAgent,
  runFrontendAgent,
  runPlannerAgent,
  runSchemaAgent,
} from "@stackforge/agents";
import { BlueprintSchema } from "@stackforge/shared";
import { detectAffectedAgents, FEATURE_AGENT_ORDER, type FeatureAgentId } from "./deltaDetector.js";
import { generateBlueprintDiff, type DiffObject } from "./diffGenerator.js";

type AddFeatureInput = {
  runId: string;
  previousOutput: unknown;
  featureRequest: string;
  provider: LLMProvider;
};

export type AddFeatureResult = {
  updatedOutput: Blueprint;
  diff: DiffObject;
  agentsRerun: FeatureAgentId[];
};

class UpdateRunProvider implements LLMProvider {
  readonly name: string;

  constructor(
    private readonly base: LLMProvider,
    private readonly featureRequest: string,
    private readonly contextBlueprint: Blueprint,
  ) {
    this.name = `${base.name}-update`;
  }

  call(input: Parameters<LLMProvider["call"]>[0]): ReturnType<LLMProvider["call"]> {
    const updateInstruction = [
      "This is an UPDATE run.",
      "The existing blueprint is provided as context.",
      `Modify ONLY what is needed for: ${this.featureRequest}`,
      "Return only JSON for the expected section.",
    ].join(" ");

    const contextBlock = JSON.stringify(this.contextBlueprint);

    return this.base.call({
      ...input,
      options: {
        ...input.options,
        systemPrompt: `${input.options.systemPrompt}\n\n${updateInstruction}`,
        userPrompt: `${input.options.userPrompt}\n\nExisting blueprint context:\n${contextBlock}`,
      },
    });
  }
}

function toUpdatePrompt(runId: string, featureRequest: string, current: Blueprint): string {
  return [
    `Run ID: ${runId}`,
    `Feature request: ${featureRequest}`,
    "This is an UPDATE run. Keep all existing blueprint sections stable unless affected.",
    `Existing blueprint JSON:\n${JSON.stringify(current)}`,
  ].join("\n\n");
}

export async function addFeatureToBlueprint({
  runId,
  previousOutput,
  featureRequest,
  provider,
}: AddFeatureInput): Promise<AddFeatureResult> {
  const parsed = BlueprintSchema.safeParse(previousOutput);
  if (!parsed.success) {
    throw new Error("Invalid previousOutput blueprint payload");
  }

  const baseBlueprint = parsed.data;
  let updatedBlueprint: Blueprint = structuredClone(baseBlueprint);

  const agentsRerun = await detectAffectedAgents(featureRequest, provider);
  const orderedAgents = FEATURE_AGENT_ORDER.filter((agent) => agentsRerun.includes(agent));

  const updateProvider = new UpdateRunProvider(provider, featureRequest, baseBlueprint);
  const cache = new AgentCache();

  for (const agentId of orderedAgents) {
    const updatePrompt = toUpdatePrompt(runId, featureRequest, updatedBlueprint);

    switch (agentId) {
      case "planner": {
        const planner = await runPlannerAgent(
          {
            prompt: updatePrompt,
            projectName: updatedBlueprint.projectName,
          },
          updateProvider,
          cache,
        );

        updatedBlueprint = {
          ...updatedBlueprint,
          projectName: planner.output.projectName,
          stack: planner.output.stack,
          folderStructure: planner.output.folderStructure,
        };
        break;
      }

      case "schema": {
        const schema = await runSchemaAgent(
          {
            prompt: updatePrompt,
            projectName: updatedBlueprint.projectName,
            stack: updatedBlueprint.stack,
          },
          updateProvider,
          cache,
        );

        updatedBlueprint = {
          ...updatedBlueprint,
          entities: schema.output.entities,
          relationships: schema.output.relationships,
        };
        break;
      }

      case "api": {
        const api = await runApiAgent(
          {
            prompt: updatePrompt,
            entities: updatedBlueprint.entities,
            stack: updatedBlueprint.stack,
          },
          updateProvider,
          cache,
        );

        updatedBlueprint = {
          ...updatedBlueprint,
          routePlan: api.output.routePlan,
        };
        break;
      }

      case "frontend": {
        const frontend = await runFrontendAgent(
          {
            prompt: updatePrompt,
            entities: updatedBlueprint.entities,
            routePlan: updatedBlueprint.routePlan,
            stack: updatedBlueprint.stack,
          },
          updateProvider,
          cache,
        );

        updatedBlueprint = {
          ...updatedBlueprint,
          frontendPages: frontend.output.frontendPages,
        };
        break;
      }

      case "devops": {
        const devops = await runDevopsAgent(
          {
            prompt: updatePrompt,
            stack: updatedBlueprint.stack,
            entities: updatedBlueprint.entities,
          },
          updateProvider,
          cache,
        );

        updatedBlueprint = {
          ...updatedBlueprint,
          infraPlan: devops.output.infraPlan,
          generatedFilesPlan: devops.output.generatedFilesPlan,
        };
        break;
      }
    }
  }

  updatedBlueprint = {
    ...updatedBlueprint,
    generatedAt: new Date().toISOString(),
  };

  const diff = generateBlueprintDiff(baseBlueprint, updatedBlueprint);

  return {
    updatedOutput: updatedBlueprint,
    diff,
    agentsRerun,
  };
}
