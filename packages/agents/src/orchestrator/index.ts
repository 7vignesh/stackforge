import type {
  AgentName,
  ApiRoute,
  Blueprint,
  Entity,
  FrontendPage,
  GenerateExecution,
  GeneratedFile,
  GeneratedSourceFile,
  InfraPlan,
  Relationship,
  ReviewerNote,
  SSEEvent,
  TechStack,
} from "@stackforge/shared";
import type { AgentCache } from "../cache/agent.cache.js";
import type { LLMProvider } from "../provider/provider.interface.js";
import { AGENT_CONFIGS } from "../config/agent.configs.js";
import {
  buildApiOutput,
  buildCodegenOutput,
  buildDevopsOutput,
  buildFrontendOutput,
  buildPlannerOutput,
  buildReviewerOutput,
  buildSchemaOutput,
} from "../provider/mock.data.js";
import { SkillRegistry } from "../skills/registry.js";
import { WorkflowEngine } from "../workflow/engine.js";
import { selectWorkflow } from "../workflow/router.js";
import type { WorkflowDefinition, WorkflowState } from "../workflow/types.js";

export type OrchestratorOptions = {
  jobId: string;
  prompt: string;
  projectName: string;
  execution?: GenerateExecution;
  emit: (event: SSEEvent) => void;
  provider: LLMProvider;
  cache: AgentCache;
};

type ResolvedExecution = {
  enableCodeGeneration: boolean;
  tokenBudget: {
    maxTotalTokens?: number;
    perAgent: Partial<Record<AgentName, number>>;
    enforcement: "strict" | "warn";
  };
};

let sharedSkillRegistry: SkillRegistry | undefined;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function now(): string {
  return new Date().toISOString();
}

function normalizePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

function resolveExecution(execution?: GenerateExecution): ResolvedExecution {
  const maxTotalTokens = normalizePositiveInt(execution?.tokenBudget?.maxTotalTokens);
  const perAgentRaw = execution?.tokenBudget?.perAgent;
  const perAgent: Partial<Record<AgentName, number>> = {};

  if (perAgentRaw !== undefined) {
    for (const [agent, value] of Object.entries(perAgentRaw) as Array<[AgentName, number]>) {
      const normalized = normalizePositiveInt(value);
      if (normalized !== undefined) {
        perAgent[agent] = normalized;
      }
    }
  }

  return {
    enableCodeGeneration: execution?.enableCodeGeneration ?? true,
    tokenBudget: {
      ...(maxTotalTokens !== undefined ? { maxTotalTokens } : {}),
      perAgent,
      enforcement: execution?.tokenBudget?.enforcement ?? "strict",
    },
  };
}

function filterWorkflowByExecution(
  workflow: WorkflowDefinition,
  execution: ResolvedExecution,
): WorkflowDefinition {
  if (execution.enableCodeGeneration) {
    return workflow;
  }

  return {
    ...workflow,
    steps: workflow.steps.filter((step) => step.agent !== "codegen"),
  };
}

function assertWorkflowBudget(
  workflow: WorkflowDefinition,
  execution: ResolvedExecution,
): void {
  const maxTotalTokens = execution.tokenBudget.maxTotalTokens;
  if (maxTotalTokens === undefined || execution.tokenBudget.enforcement !== "strict") {
    return;
  }

  const minRequiredTokens = workflow.steps.reduce((sum, step) => {
    const configuredMin = AGENT_CONFIGS[step.agent].minOutputTokens;
    const override = execution.tokenBudget.perAgent[step.agent];
    const effective = override !== undefined ? Math.min(configuredMin, override) : configuredMin;
    return sum + effective;
  }, 0);

  if (maxTotalTokens < minRequiredTokens) {
    throw new Error(
      `Global token budget too low for selected workflow ` +
      `(maxTotalTokens=${maxTotalTokens}, minRequired=${minRequiredTokens})`,
    );
  }
}

function normalizeFolderType(value: unknown): "file" | "dir" {
  const raw = asString(value)?.toLowerCase();
  if (raw === "dir" || raw === "directory") {
    return "dir";
  }

  return "file";
}

function normalizeStack(raw: unknown, fallback: TechStack): TechStack {
  const record = asRecord(raw);
  if (record === undefined) {
    return fallback;
  }

  return {
    frontend: asString(record["frontend"]) ?? fallback.frontend,
    backend: asString(record["backend"]) ?? fallback.backend,
    database: asString(record["database"]) ?? fallback.database,
    auth: asString(record["auth"]) ?? fallback.auth,
    hosting: asString(record["hosting"]) ?? fallback.hosting,
    packageManager: asString(record["packageManager"]) ?? fallback.packageManager,
    monorepo: asBoolean(record["monorepo"]) ?? fallback.monorepo,
  };
}

function normalizeFolderStructure(raw: unknown, fallback: Blueprint["folderStructure"]): Blueprint["folderStructure"] {
  const normalized: Blueprint["folderStructure"] = [];
  for (const entry of asArray(raw)) {
    const record = asRecord(entry);
    if (record === undefined) {
      continue;
    }

    const nodePath = asString(record["path"]);
    if (nodePath === undefined) {
      continue;
    }

    const description = asString(record["description"]);
    const node: Blueprint["folderStructure"][number] = {
      path: nodePath,
      type: normalizeFolderType(record["type"]),
    };

    if (description !== undefined) {
      node.description = description;
    }

    normalized.push(node);
  }

  return normalized.length > 0 ? normalized : fallback;
}

function normalizeEntities(raw: unknown, fallback: Entity[]): Entity[] {
  const entities: Entity[] = [];

  for (const [entityIndex, entry] of asArray(raw).entries()) {
    const record = asRecord(entry);
    if (record === undefined) {
      continue;
    }

    const name = asString(record["name"]) ?? `Entity${entityIndex + 1}`;
    const tableName = asString(record["tableName"]) ?? name.toLowerCase();

    const fields: Entity["fields"] = [];
    for (const [fieldIndex, field] of asArray(record["fields"]).entries()) {
      const fieldRecord = asRecord(field);
      if (fieldRecord === undefined) {
        continue;
      }

      const fieldName = asString(fieldRecord["name"]) ?? `field${fieldIndex + 1}`;
      const fieldType = asString(fieldRecord["type"]) ?? "text";
      const nullable = asBoolean(fieldRecord["nullable"]) ?? false;
      const unique = asBoolean(fieldRecord["unique"]);
      const foreignKey = asString(fieldRecord["foreignKey"]);

      const normalizedField: Entity["fields"][number] = {
        name: fieldName,
        type: fieldType,
        nullable,
      };

      if (unique !== undefined) {
        normalizedField.unique = unique;
      }

      if (foreignKey !== undefined) {
        normalizedField.foreignKey = foreignKey;
      }

      fields.push(normalizedField);
    }

    const indexes: string[] = [];
    for (const indexValue of asArray(record["indexes"])) {
      const indexString = asString(indexValue);
      if (indexString !== undefined) {
        indexes.push(indexString);
      }
    }

    const normalizedEntity: Entity = {
      name,
      tableName,
      fields: fields.length > 0 ? fields : [{ name: "id", type: "uuid", nullable: false, unique: true }],
    };

    if (indexes.length > 0) {
      normalizedEntity.indexes = indexes;
    }

    entities.push(normalizedEntity);
  }

  return entities.length > 0 ? entities : fallback;
}

function normalizeRelationships(raw: unknown, fallback: Relationship[]): Relationship[] {
  const allowed = new Set<Relationship["type"]>(["one-to-one", "one-to-many", "many-to-many"]);

  const relationships = asArray(raw)
    .map((entry) => {
      const record = asRecord(entry);
      if (record === undefined) {
        return undefined;
      }

      const from = asString(record["from"]);
      const to = asString(record["to"]);
      const description = asString(record["description"]);
      const rawType = asString(record["type"]);
      const type = rawType !== undefined && allowed.has(rawType as Relationship["type"])
        ? rawType as Relationship["type"]
        : "one-to-many";

      if (from === undefined || to === undefined || description === undefined) {
        return undefined;
      }

      return { from, to, type, description };
    })
    .filter((relationship): relationship is Relationship => relationship !== undefined);

  return relationships.length > 0 ? relationships : fallback;
}

function normalizeRoutePlan(raw: unknown, fallback: ApiRoute[]): ApiRoute[] {
  const allowedMethods = new Set<ApiRoute["method"]>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  const routes: ApiRoute[] = [];
  for (const entry of asArray(raw)) {
    const record = asRecord(entry);
    if (record === undefined) {
      continue;
    }

    const rawMethod = asString(record["method"])?.toUpperCase();
    const method = rawMethod !== undefined && allowedMethods.has(rawMethod as ApiRoute["method"])
      ? rawMethod as ApiRoute["method"]
      : "GET";
    const routePath = asString(record["path"]);
    if (routePath === undefined) {
      continue;
    }

    const description = asString(record["description"]) ?? "Generated endpoint";
    const auth = asBoolean(record["auth"]) ?? true;
    const requestBody = asString(record["requestBody"]);
    const responseType = asString(record["responseType"]) ?? "object";

    const normalizedRoute: ApiRoute = {
      method,
      path: routePath,
      description,
      auth,
      responseType,
    };

    if (requestBody !== undefined) {
      normalizedRoute.requestBody = requestBody;
    }

    routes.push(normalizedRoute);
  }

  return routes.length > 0 ? routes : fallback;
}

function normalizeFrontendPages(raw: unknown, fallback: FrontendPage[]): FrontendPage[] {
  const pages = asArray(raw)
    .map((entry, index) => {
      const record = asRecord(entry);
      if (record === undefined) {
        return undefined;
      }

      const route = asString(record["route"]) ?? `/generated-${index + 1}`;
      const name = asString(record["name"]) ?? `GeneratedPage${index + 1}`;
      const auth = asBoolean(record["auth"]) ?? false;
      const description = asString(record["description"]) ?? "Generated page";
      const components = asArray(record["components"])
        .map((component) => asString(component))
        .filter((component): component is string => component !== undefined);

      return {
        route,
        name,
        components: components.length > 0 ? components : ["PageShell"],
        auth,
        description,
      };
    })
    .filter((page): page is FrontendPage => page !== undefined);

  return pages.length > 0 ? pages : fallback;
}

function normalizeInfraPlan(raw: unknown, fallback: InfraPlan): InfraPlan {
  const record = asRecord(raw);
  if (record === undefined) {
    return fallback;
  }

  const ci = asArray(record["ci"])
    .map((value) => asString(value))
    .filter((value): value is string => value !== undefined);
  const deployment = asArray(record["deployment"])
    .map((value) => asString(value))
    .filter((value): value is string => value !== undefined);
  const envVars = asArray(record["envVars"])
    .map((value) => asString(value))
    .filter((value): value is string => value !== undefined);

  return {
    ci: ci.length > 0 ? ci : fallback.ci,
    docker: asBoolean(record["docker"]) ?? fallback.docker,
    deployment: deployment.length > 0 ? deployment : fallback.deployment,
    envVars: envVars.length > 0 ? envVars : fallback.envVars,
  };
}

function normalizeGeneratedFilesPlan(raw: unknown, fallback: GeneratedFile[]): GeneratedFile[] {
  const files = asArray(raw)
    .map((entry) => {
      const record = asRecord(entry);
      if (record === undefined) {
        return undefined;
      }

      const path = asString(record["path"]);
      if (path === undefined) {
        return undefined;
      }

      return {
        path,
        generator: asString(record["generator"]) ?? "workflow-engine",
        description: asString(record["description"]) ?? "Generated workflow artifact",
      };
    })
    .filter((entry): entry is GeneratedFile => entry !== undefined);

  return files.length > 0 ? files : fallback;
}

function normalizeReviewerNotes(raw: unknown, fallback: ReviewerNote[]): ReviewerNote[] {
  const allowed = new Set<ReviewerNote["severity"]>(["info", "warning", "error"]);

  const notes = asArray(raw)
    .map((entry) => {
      const record = asRecord(entry);
      if (record === undefined) {
        return undefined;
      }

      const note = asString(record["note"]);
      if (note === undefined) {
        return undefined;
      }

      const severityRaw = asString(record["severity"]);
      const severity = severityRaw !== undefined && allowed.has(severityRaw as ReviewerNote["severity"])
        ? severityRaw as ReviewerNote["severity"]
        : "info";

      return {
        severity,
        agent: asString(record["agent"]) ?? "reviewer",
        note,
      };
    })
    .filter((entry): entry is ReviewerNote => entry !== undefined);

  return notes.length > 0 ? notes : fallback;
}

function normalizeGeneratedSourceFiles(
  raw: unknown,
  fallback: GeneratedSourceFile[],
): GeneratedSourceFile[] {
  // Handle string input (raw code from provider) by wrapping it in structured format
  let record = asRecord(raw);
  if (record === undefined && typeof raw === "string") {
    record = {
      generatedSourceFiles: [
        {
          path: "generated-code.ts",
          language: "typescript",
          content: raw,
        },
      ],
    };
  }

  const direct: GeneratedSourceFile[] = [];
  for (const entry of asArray(record?.["generatedSourceFiles"])) {
    const file = asRecord(entry);
    if (file === undefined) {
      continue;
    }

    const filePath = asString(file["path"]);
    const content = asString(file["content"]);
    if (filePath === undefined || content === undefined) {
      continue;
    }

    const normalized: GeneratedSourceFile = {
      path: filePath,
      content,
    };

    const language = asString(file["language"]);
    if (language !== undefined) {
      normalized.language = language;
    }

    direct.push(normalized);
  }

  const objectFiles = (() => {
    const filesRecord = asRecord(record?.["files"]);
    if (filesRecord === undefined) {
      return [] as GeneratedSourceFile[];
    }

    return Object.entries(filesRecord).map(([filePath, value]): GeneratedSourceFile => {
      const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return { path: filePath, content };
    });
  })();

  const merged = [...direct, ...objectFiles];
  return merged.length > 0 ? merged : fallback;
}

function assembleBlueprintFromWorkflow(
  projectName: string,
  execution: ResolvedExecution,
  state: WorkflowState,
  rawOutputsByStateKey: Record<string, unknown>,
): Blueprint {
  const plannerDefaults = buildPlannerOutput(projectName);
  const schemaDefaults = buildSchemaOutput();
  const apiDefaults = buildApiOutput();
  const frontendDefaults = buildFrontendOutput();

  const planRaw = rawOutputsByStateKey["plan"] ?? state["plan"];
  const plannerRecord = asRecord(planRaw) ?? {};
  const resolvedProjectName = asString(plannerRecord["projectName"]) ?? plannerDefaults.projectName;
  const stack = normalizeStack(plannerRecord["stack"], plannerDefaults.stack);
  const folderStructure = normalizeFolderStructure(plannerRecord["folderStructure"], plannerDefaults.folderStructure);

  const schemaRaw = rawOutputsByStateKey["schema"] ?? state["schema"];
  const schemaRecord = asRecord(schemaRaw) ?? {};
  const entities = normalizeEntities(schemaRecord["entities"], schemaDefaults.entities);
  const relationships = normalizeRelationships(schemaRecord["relationships"], schemaDefaults.relationships);

  const apiRaw = rawOutputsByStateKey["api"] ?? state["api"];
  const apiRecord = asRecord(apiRaw) ?? {};
  const routePlan = normalizeRoutePlan(apiRecord["routePlan"], apiDefaults.routePlan);

  const frontendRaw = rawOutputsByStateKey["frontend"] ?? state["frontend"];
  const frontendRecord = asRecord(frontendRaw) ?? {};
  const frontendPages = normalizeFrontendPages(frontendRecord["frontendPages"], frontendDefaults.frontendPages);

  const devopsDefaults = buildDevopsOutput(resolvedProjectName);
  const devopsRaw = rawOutputsByStateKey["devops"] ?? state["devops"];
  const devopsRecord = asRecord(devopsRaw) ?? {};
  const infraPlan = normalizeInfraPlan(devopsRecord["infraPlan"], devopsDefaults.infraPlan);
  const generatedFilesPlan = normalizeGeneratedFilesPlan(
    devopsRecord["generatedFilesPlan"],
    devopsDefaults.generatedFilesPlan,
  );

  const reviewerDefaults = buildReviewerOutput();
  const reviewerRaw = rawOutputsByStateKey["reviewer"] ?? state["reviewer"];
  const reviewerRecord = asRecord(reviewerRaw) ?? {};
  const reviewerNotes = normalizeReviewerNotes(reviewerRecord["reviewerNotes"], reviewerDefaults.reviewerNotes);

  let generatedSourceFiles: GeneratedSourceFile[] | undefined;
  if (execution.enableCodeGeneration) {
    const codegenDefaults = buildCodegenOutput(resolvedProjectName);
    const codegenRaw = rawOutputsByStateKey["codegen"] ?? state["codegen"];
    generatedSourceFiles = normalizeGeneratedSourceFiles(
      codegenRaw,
      codegenDefaults.generatedSourceFiles,
    );
  }

  return {
    projectName: resolvedProjectName,
    generatedAt: now(),
    stack,
    folderStructure,
    entities,
    relationships,
    routePlan,
    frontendPages,
    infraPlan,
    generatedFilesPlan,
    reviewerNotes,
    ...(generatedSourceFiles !== undefined ? { generatedSourceFiles } : {}),
  };
}

async function getSkillRegistry(): Promise<SkillRegistry> {
  if (sharedSkillRegistry !== undefined) {
    return sharedSkillRegistry;
  }

  const registry = new SkillRegistry();
  await registry.initialize();
  sharedSkillRegistry = registry;
  return registry;
}

export async function runOrchestrator(options: OrchestratorOptions): Promise<Blueprint> {
  const { jobId, prompt, projectName, execution, emit, provider, cache } = options;
  const resolvedExecution = resolveExecution(execution);
  const skillRegistry = await getSkillRegistry();

  const selectedWorkflow = filterWorkflowByExecution(selectWorkflow(prompt), resolvedExecution);
  assertWorkflowBudget(selectedWorkflow, resolvedExecution);

  const workflowEngine = new WorkflowEngine({
    jobId,
    userGoal: prompt,
    provider,
    cache,
    emit,
    skillRegistry,
  });

  const finalState = await workflowEngine.run(selectedWorkflow, {
    goal: prompt,
    projectName,
  });

  const workflowMeta = workflowEngine.getLastRunMeta();
  const usedTokens = workflowMeta?.totalTokensUsed ?? 0;
  const maxTotalTokens = resolvedExecution.tokenBudget.maxTotalTokens;

  if (
    maxTotalTokens !== undefined
    && usedTokens > maxTotalTokens
    && resolvedExecution.tokenBudget.enforcement === "strict"
  ) {
    throw new Error(
      `Global token budget exceeded after workflow execution (used=${usedTokens}, maxTotalTokens=${maxTotalTokens})`,
    );
  }

  if (
    maxTotalTokens !== undefined
    && usedTokens > maxTotalTokens
    && resolvedExecution.tokenBudget.enforcement === "warn"
  ) {
    process.stderr.write(
      `[orchestrator] Global token budget exceeded (used=${usedTokens}, maxTotalTokens=${maxTotalTokens})\n`,
    );
  }

  return assembleBlueprintFromWorkflow(
    projectName,
    resolvedExecution,
    finalState,
    workflowMeta?.rawOutputsByStateKey ?? {},
  );
}
