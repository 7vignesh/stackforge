import { z } from "zod";

const TechStackSchema = z.object({
  frontend: z.string(),
  backend: z.string(),
  database: z.string(),
  auth: z.string(),
  hosting: z.string(),
  packageManager: z.string(),
  monorepo: z.boolean(),
});

const FolderNodeSchema = z.object({
  path: z.string(),
  type: z.enum(["file", "dir"]),
  description: z.string().optional(),
});

const EntityFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  unique: z.boolean().optional(),
  foreignKey: z.string().optional(),
});

const EntitySchema = z.object({
  name: z.string(),
  tableName: z.string(),
  fields: z.array(EntityFieldSchema),
  indexes: z.array(z.string()).optional(),
});

const RelationshipSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["one-to-one", "one-to-many", "many-to-many"]),
  description: z.string(),
});

const ApiRouteSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string(),
  description: z.string(),
  auth: z.boolean(),
  requestBody: z.string().optional(),
  responseType: z.string(),
});

const FrontendPageSchema = z.object({
  route: z.string(),
  name: z.string(),
  components: z.array(z.string()),
  auth: z.boolean(),
  description: z.string(),
});

const InfraPlanSchema = z.object({
  ci: z.array(z.string()),
  docker: z.boolean(),
  deployment: z.array(z.string()),
  envVars: z.array(z.string()),
});

const GeneratedFileSchema = z.object({
  path: z.string(),
  generator: z.string(),
  description: z.string(),
});

const ReviewerNoteSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  agent: z.string(),
  note: z.string(),
});

export const BlueprintSchema = z.object({
  projectName: z.string(),
  generatedAt: z.string().datetime(),
  stack: TechStackSchema,
  folderStructure: z.array(FolderNodeSchema),
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema),
  routePlan: z.array(ApiRouteSchema),
  frontendPages: z.array(FrontendPageSchema),
  infraPlan: InfraPlanSchema,
  generatedFilesPlan: z.array(GeneratedFileSchema),
  reviewerNotes: z.array(ReviewerNoteSchema),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;
export type TechStack = z.infer<typeof TechStackSchema>;
export type FolderNode = z.infer<typeof FolderNodeSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type EntityField = z.infer<typeof EntityFieldSchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type ApiRoute = z.infer<typeof ApiRouteSchema>;
export type FrontendPage = z.infer<typeof FrontendPageSchema>;
export type InfraPlan = z.infer<typeof InfraPlanSchema>;
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;
export type ReviewerNote = z.infer<typeof ReviewerNoteSchema>;
