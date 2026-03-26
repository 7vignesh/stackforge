import { BlueprintSchema } from "@stackforge/shared";

export const PlannerOutputSchema = BlueprintSchema.pick({
  projectName: true,
  stack: true,
  folderStructure: true,
});

export const SchemaOutputSchema = BlueprintSchema.pick({
  entities: true,
  relationships: true,
});

export const ApiOutputSchema = BlueprintSchema.pick({
  routePlan: true,
});

export const FrontendOutputSchema = BlueprintSchema.pick({
  frontendPages: true,
});

export const DevopsOutputSchema = BlueprintSchema.pick({
  infraPlan: true,
  generatedFilesPlan: true,
});

export const ReviewerOutputSchema = BlueprintSchema.pick({
  reviewerNotes: true,
});

export const AgentOutputSchemas = {
  planner: PlannerOutputSchema,
  schema: SchemaOutputSchema,
  api: ApiOutputSchema,
  frontend: FrontendOutputSchema,
  devops: DevopsOutputSchema,
  reviewer: ReviewerOutputSchema,
} as const;
