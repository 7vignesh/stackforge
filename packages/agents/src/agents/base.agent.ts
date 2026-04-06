import type { AgentName } from "@stackforge/shared";
import type { LLMProvider } from "../provider/provider.interface.js";
import type { AgentCache } from "../cache/agent.cache.js";
import { optimizeAgentPayload } from "../optimizer/token.optimizer.js";
import { AgentOutputSchemas } from "./output.schemas.js";

const DEFAULT_PLANNER_STACK = {
  frontend: "React + TypeScript",
  backend: "Node.js + Express",
  database: "PostgreSQL",
  auth: "JWT",
  hosting: "Docker + managed cloud",
  packageManager: "Bun",
  monorepo: true,
} as const;

const DEFAULT_FOLDER_STRUCTURE = [
  { path: "apps/api/src", type: "dir", description: "Backend application source" },
  { path: "apps/web/src", type: "dir", description: "Frontend application source" },
] as const;

const ROUTE_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const RELATIONSHIP_TYPES = new Set(["one-to-one", "one-to-many", "many-to-many"]);
const REVIEW_SEVERITIES = new Set(["info", "warning", "error"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asNonEmptyString(item))
    .filter((item): item is string => item !== undefined);
}

function hasAnyKey(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => key in value);
}

function toSnakeCase(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return normalized.length > 0 ? normalized : "entity";
}

function toPluralTableName(entityName: string): string {
  const snake = toSnakeCase(entityName);
  return snake.endsWith("s") ? snake : `${snake}s`;
}

function normalizeFolderType(rawType: unknown, path: string): "file" | "dir" {
  const type = asNonEmptyString(rawType)?.toLowerCase();
  if (type === "file") {
    return "file";
  }
  if (type === "dir" || type === "folder" || type === "directory") {
    return "dir";
  }

  return path.includes(".") ? "file" : "dir";
}

function normalizeFolderNode(value: unknown): { path: string; type: "file" | "dir"; description?: string } | undefined {
  const node = asRecord(value);
  if (node === undefined) {
    return undefined;
  }

  const path = asNonEmptyString(node["path"]);
  if (path === undefined) {
    return undefined;
  }

  const normalized: { path: string; type: "file" | "dir"; description?: string } = {
    path,
    type: normalizeFolderType(node["type"], path),
  };

  const description = asNonEmptyString(node["description"]);
  if (description !== undefined) {
    normalized.description = description;
  }

  return normalized;
}

function normalizePlannerOutput(rawOutput: unknown, input: unknown): unknown {
  const output = asRecord(rawOutput);
  if (output === undefined) {
    return rawOutput;
  }

  const hasPlannerShape =
    "projectName" in output ||
    "stack" in output ||
    "folderStructure" in output;

  // Preserve strict failures for completely invalid planner payloads.
  if (!hasPlannerShape) {
    return rawOutput;
  }

  const inputRecord = asRecord(input);
  const rawStack = asRecord(output["stack"]) ?? {};
  const rawFolderStructure = Array.isArray(output["folderStructure"]) ? output["folderStructure"] : [];
  const folderStructure = rawFolderStructure
    .map((item) => normalizeFolderNode(item))
    .filter((item): item is { path: string; type: "file" | "dir"; description?: string } => item !== undefined);

  return {
    projectName:
      asNonEmptyString(output["projectName"]) ??
      asNonEmptyString(inputRecord?.["projectName"]) ??
      "generated-project",
    stack: {
      frontend: asNonEmptyString(rawStack["frontend"]) ?? DEFAULT_PLANNER_STACK.frontend,
      backend: asNonEmptyString(rawStack["backend"]) ?? DEFAULT_PLANNER_STACK.backend,
      database: asNonEmptyString(rawStack["database"]) ?? DEFAULT_PLANNER_STACK.database,
      auth: asNonEmptyString(rawStack["auth"]) ?? DEFAULT_PLANNER_STACK.auth,
      hosting: asNonEmptyString(rawStack["hosting"]) ?? DEFAULT_PLANNER_STACK.hosting,
      packageManager: asNonEmptyString(rawStack["packageManager"]) ?? DEFAULT_PLANNER_STACK.packageManager,
      monorepo:
        typeof rawStack["monorepo"] === "boolean"
          ? rawStack["monorepo"]
          : DEFAULT_PLANNER_STACK.monorepo,
    },
    folderStructure:
      folderStructure.length > 0
        ? folderStructure
        : DEFAULT_FOLDER_STRUCTURE.map((node) => ({ ...node })),
  };
}

function normalizeEntityField(value: unknown, index: number): {
  name: string;
  type: string;
  nullable: boolean;
  unique?: boolean;
  foreignKey?: string;
} | undefined {
  const field = asRecord(value);
  if (field === undefined) {
    return undefined;
  }

  const normalized: {
    name: string;
    type: string;
    nullable: boolean;
    unique?: boolean;
    foreignKey?: string;
  } = {
    name: asNonEmptyString(field["name"]) ?? `field_${index + 1}`,
    type: asNonEmptyString(field["type"]) ?? "text",
    nullable: asBoolean(field["nullable"]) ?? false,
  };

  const unique = asBoolean(field["unique"]);
  if (unique !== undefined) {
    normalized.unique = unique;
  }

  const foreignKey = asNonEmptyString(field["foreignKey"]);
  if (foreignKey !== undefined) {
    normalized.foreignKey = foreignKey;
  }

  return normalized;
}

function normalizeEntity(value: unknown, index: number): {
  name: string;
  tableName: string;
  fields: Array<{
    name: string;
    type: string;
    nullable: boolean;
    unique?: boolean;
    foreignKey?: string;
  }>;
  indexes?: string[];
} | undefined {
  const entity = asRecord(value);
  if (entity === undefined) {
    return undefined;
  }

  const name = asNonEmptyString(entity["name"]) ?? `Entity${index + 1}`;
  const tableName = asNonEmptyString(entity["tableName"]) ?? toPluralTableName(name);

  const rawFields = Array.isArray(entity["fields"]) ? entity["fields"] : [];
  const fields = rawFields
    .map((field, fieldIndex) => normalizeEntityField(field, fieldIndex))
    .filter((field): field is {
      name: string;
      type: string;
      nullable: boolean;
      unique?: boolean;
      foreignKey?: string;
    } => field !== undefined);

  const normalized: {
    name: string;
    tableName: string;
    fields: Array<{
      name: string;
      type: string;
      nullable: boolean;
      unique?: boolean;
      foreignKey?: string;
    }>;
    indexes?: string[];
  } = {
    name,
    tableName,
    fields: fields.length > 0
      ? fields
      : [{ name: "id", type: "uuid", nullable: false, unique: true }],
  };

  const indexes = asStringArray(entity["indexes"]);
  if (indexes.length > 0) {
    normalized.indexes = indexes;
  }

  return normalized;
}

function normalizeRelationship(
  value: unknown,
  entities: Array<{ name: string }>,
): {
  from: string;
  to: string;
  type: "one-to-one" | "one-to-many" | "many-to-many";
  description: string;
} | undefined {
  const relationship = asRecord(value);
  if (relationship === undefined) {
    return undefined;
  }

  const from = asNonEmptyString(relationship["from"]) ?? entities[0]?.name ?? "Entity1";
  const to = asNonEmptyString(relationship["to"]) ?? entities[1]?.name ?? from;
  const rawType = asNonEmptyString(relationship["type"]);
  const type = RELATIONSHIP_TYPES.has(rawType ?? "")
    ? (rawType as "one-to-one" | "one-to-many" | "many-to-many")
    : "one-to-many";

  return {
    from,
    to,
    type,
    description: asNonEmptyString(relationship["description"]) ?? `${from} ${type} ${to}`,
  };
}

function normalizeSchemaOutput(rawOutput: unknown): unknown {
  const output = asRecord(rawOutput);
  if (output === undefined) {
    return rawOutput;
  }

  if (!hasAnyKey(output, ["entities", "relationships"])) {
    return rawOutput;
  }

  const rawEntities = Array.isArray(output["entities"]) ? output["entities"] : [];
  const entities = rawEntities
    .map((entity, index) => normalizeEntity(entity, index))
    .filter((entity): entity is {
      name: string;
      tableName: string;
      fields: Array<{
        name: string;
        type: string;
        nullable: boolean;
        unique?: boolean;
        foreignKey?: string;
      }>;
      indexes?: string[];
    } => entity !== undefined);

  const safeEntities = entities.length > 0
    ? entities
    : [{
      name: "Task",
      tableName: "tasks",
      fields: [{ name: "id", type: "uuid", nullable: false, unique: true }],
    }];

  const rawRelationships = Array.isArray(output["relationships"]) ? output["relationships"] : [];
  const relationships = rawRelationships
    .map((relationship) => normalizeRelationship(relationship, safeEntities))
    .filter((relationship): relationship is {
      from: string;
      to: string;
      type: "one-to-one" | "one-to-many" | "many-to-many";
      description: string;
    } => relationship !== undefined);

  return {
    entities: safeEntities,
    relationships,
  };
}

function normalizeApiRoute(value: unknown, index: number): {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  auth: boolean;
  requestBody?: string;
  responseType: string;
} | undefined {
  const route = asRecord(value);
  if (route === undefined) {
    return undefined;
  }

  const rawMethod = asNonEmptyString(route["method"])?.toUpperCase();
  const method = ROUTE_METHODS.has(rawMethod ?? "")
    ? (rawMethod as "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
    : "GET";

  const rawPath = asNonEmptyString(route["path"]) ?? `/resource-${index + 1}`;
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;

  const normalized: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    description: string;
    auth: boolean;
    requestBody?: string;
    responseType: string;
  } = {
    method,
    path,
    description: asNonEmptyString(route["description"]) ?? `${method} ${path}`,
    auth: asBoolean(route["auth"]) ?? false,
    responseType: asNonEmptyString(route["responseType"]) ?? "object",
  };

  const requestBody = asNonEmptyString(route["requestBody"]);
  if (requestBody !== undefined) {
    normalized.requestBody = requestBody;
  }

  return normalized;
}

function normalizeApiOutput(rawOutput: unknown): unknown {
  const output = asRecord(rawOutput);
  if (output === undefined) {
    return rawOutput;
  }

  if (!hasAnyKey(output, ["routePlan"])) {
    return rawOutput;
  }

  const rawRoutes = Array.isArray(output["routePlan"]) ? output["routePlan"] : [];
  const routePlan = rawRoutes
    .map((route, index) => normalizeApiRoute(route, index))
    .filter((route): route is {
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      path: string;
      description: string;
      auth: boolean;
      requestBody?: string;
      responseType: string;
    } => route !== undefined);

  return {
    routePlan: routePlan.length > 0
      ? routePlan
      : [{
        method: "GET",
        path: "/health",
        description: "Health check endpoint",
        auth: false,
        responseType: "HealthResponse",
      }],
  };
}

function normalizeFrontendPage(value: unknown, index: number): {
  route: string;
  name: string;
  components: string[];
  auth: boolean;
  description: string;
} | undefined {
  const page = asRecord(value);
  if (page === undefined) {
    return undefined;
  }

  const rawRoute = asNonEmptyString(page["route"]) ?? `/page-${index + 1}`;
  const route = rawRoute.startsWith("/") ? rawRoute : `/${rawRoute}`;
  const name = asNonEmptyString(page["name"]) ?? `Page${index + 1}`;
  const components = asStringArray(page["components"]);

  return {
    route,
    name,
    components: components.length > 0 ? components : [`${name}View`],
    auth: asBoolean(page["auth"]) ?? false,
    description: asNonEmptyString(page["description"]) ?? `${name} route implementation`,
  };
}

function normalizeFrontendOutput(rawOutput: unknown): unknown {
  const output = asRecord(rawOutput);
  if (output === undefined) {
    return rawOutput;
  }

  if (!hasAnyKey(output, ["frontendPages"])) {
    return rawOutput;
  }

  const rawPages = Array.isArray(output["frontendPages"]) ? output["frontendPages"] : [];
  const frontendPages = rawPages
    .map((page, index) => normalizeFrontendPage(page, index))
    .filter((page): page is {
      route: string;
      name: string;
      components: string[];
      auth: boolean;
      description: string;
    } => page !== undefined);

  return {
    frontendPages: frontendPages.length > 0
      ? frontendPages
      : [{
        route: "/",
        name: "HomePage",
        components: ["HomeView"],
        auth: false,
        description: "Default home page",
      }],
  };
}

function normalizeGeneratedFile(value: unknown, index: number): {
  path: string;
  generator: string;
  description: string;
} | undefined {
  const file = asRecord(value);
  if (file === undefined) {
    return undefined;
  }

  return {
    path: asNonEmptyString(file["path"]) ?? `infra/generated-${index + 1}.md`,
    generator: asNonEmptyString(file["generator"]) ?? "devops",
    description: asNonEmptyString(file["description"]) ?? "Generated infrastructure artifact",
  };
}

function normalizeDevopsOutput(rawOutput: unknown): unknown {
  const output = asRecord(rawOutput);
  if (output === undefined) {
    return rawOutput;
  }

  if (!hasAnyKey(output, ["infraPlan", "generatedFilesPlan"])) {
    return rawOutput;
  }

  const infra = asRecord(output["infraPlan"]) ?? {};
  const rawFiles = Array.isArray(output["generatedFilesPlan"]) ? output["generatedFilesPlan"] : [];
  const generatedFilesPlan = rawFiles
    .map((file, index) => normalizeGeneratedFile(file, index))
    .filter((file): file is {
      path: string;
      generator: string;
      description: string;
    } => file !== undefined);

  return {
    infraPlan: {
      ci: asStringArray(infra["ci"]),
      docker: asBoolean(infra["docker"]) ?? true,
      deployment: asStringArray(infra["deployment"]),
      envVars: asStringArray(infra["envVars"]),
    },
    generatedFilesPlan: generatedFilesPlan.length > 0
      ? generatedFilesPlan
      : [{
        path: "Dockerfile",
        generator: "devops",
        description: "Container image definition",
      }],
  };
}

function normalizeReviewerNote(value: unknown, index: number): {
  severity: "info" | "warning" | "error";
  agent: string;
  note: string;
} | undefined {
  const note = asRecord(value);
  if (note === undefined) {
    return undefined;
  }

  const rawSeverity = asNonEmptyString(note["severity"]);
  const severity = REVIEW_SEVERITIES.has(rawSeverity ?? "")
    ? (rawSeverity as "info" | "warning" | "error")
    : "info";

  return {
    severity,
    agent: asNonEmptyString(note["agent"]) ?? "reviewer",
    note: asNonEmptyString(note["note"]) ?? `Review note ${index + 1}`,
  };
}

function normalizeReviewerOutput(rawOutput: unknown): unknown {
  const output = asRecord(rawOutput);
  if (output === undefined) {
    return rawOutput;
  }

  if (!hasAnyKey(output, ["reviewerNotes"])) {
    return rawOutput;
  }

  const rawNotes = Array.isArray(output["reviewerNotes"]) ? output["reviewerNotes"] : [];
  const reviewerNotes = rawNotes
    .map((note, index) => normalizeReviewerNote(note, index))
    .filter((note): note is {
      severity: "info" | "warning" | "error";
      agent: string;
      note: string;
    } => note !== undefined);

  return { reviewerNotes };
}

function normalizeAgentOutput(agentName: AgentName, rawOutput: unknown, input: unknown): unknown {
  switch (agentName) {
    case "planner":
      return normalizePlannerOutput(rawOutput, input);
    case "schema":
      return normalizeSchemaOutput(rawOutput);
    case "api":
      return normalizeApiOutput(rawOutput);
    case "frontend":
      return normalizeFrontendOutput(rawOutput);
    case "devops":
      return normalizeDevopsOutput(rawOutput);
    case "reviewer":
      return normalizeReviewerOutput(rawOutput);
    default:
      return rawOutput;
  }
}

export type AgentRunResult<T> = {
  agentName: AgentName;
  output: T;
  cached: boolean;
  durationMs: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedInputTokens: number;
  compressionPasses: number;
  providerInputTokens: number;
  providerOutputTokens: number;
  model: string;
};

export async function runAgent<TInput, TOutput>(
  agentName: AgentName,
  input: TInput,
  provider: LLMProvider,
  cache: AgentCache,
): Promise<AgentRunResult<TOutput>> {
  const cacheKey = cache.hash({ agent: agentName, input });
  const cached = cache.get(cacheKey);

  if (cached !== undefined) {
    return {
      agentName,
      output: cached.output as TOutput,
      cached: true,
      durationMs: 0,
      tokensUsed: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedInputTokens: 0,
      compressionPasses: 0,
      providerInputTokens: 0,
      providerOutputTokens: 0,
      model: "cache",
    };
  }

  const start = Date.now();
  const optimized = optimizeAgentPayload(agentName, input);
  const response = await provider.call({
    agentName,
    input: optimized.optimizedInput,
    options: {
      systemPrompt: optimized.systemPrompt,
      userPrompt: optimized.userPrompt,
      model: optimized.model,
      maxInputTokens: optimized.maxInputTokens,
      maxOutputTokens: optimized.maxOutputTokens,
      temperature: optimized.temperature,
    },
  });
  const durationMs = Date.now() - start;
  const schema = AgentOutputSchemas[agentName];
  const normalizedOutput = normalizeAgentOutput(agentName, response.output, input);
  const validatedOutput = schema.parse(normalizedOutput);

  cache.set(cacheKey, validatedOutput);

  return {
    agentName,
    output: validatedOutput as TOutput,
    cached: false,
    durationMs,
    tokensUsed: response.tokensUsed,
    inputTokens: response.inputTokens ?? optimized.estimatedInputTokens,
    outputTokens: response.outputTokens ?? optimized.maxOutputTokens,
    totalTokens: response.tokensUsed,
    estimatedInputTokens: optimized.estimatedInputTokens,
    compressionPasses: optimized.compressionPasses,
    providerInputTokens: response.inputTokens ?? optimized.estimatedInputTokens,
    providerOutputTokens: response.outputTokens ?? optimized.maxOutputTokens,
    model: response.model ?? optimized.model,
  };
}
