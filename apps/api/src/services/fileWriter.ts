import JSZip from "jszip";

type JsonRecord = Record<string, unknown>;

type EntityFieldSpec = {
  name: string;
  type: string;
  nullable: boolean;
  unique?: boolean;
  foreignKey?: string;
};

type EntitySpec = {
  name: string;
  tableName: string;
  fields: EntityFieldSpec[];
  indexes: string[];
};

type RouteSpec = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  description: string;
  auth: boolean;
  requestBody?: string;
  responseType: string;
};

type FrontendPageSpec = {
  route: string;
  name: string;
  components: string[];
  auth: boolean;
  description: string;
};

type InfraSpec = {
  docker: boolean;
  envVars: string[];
  dockerfile?: string;
  dockerCompose?: string;
};

type ExtractedPipeline = {
  projectName: string;
  stack: {
    frontend: string;
    backend: string;
    database: string;
    auth: string;
    hosting: string;
    packageManager: string;
  };
  entities: EntitySpec[];
  routePlan: RouteSpec[];
  frontendPages: FrontendPageSpec[];
  infra: InfraSpec;
};

type GroupedRoutes = {
  resource: string;
  routerName: string;
  fileName: string;
  mountPath: string;
  routes: Array<RouteSpec & { subPath: string }>;
};

export type FileWriterResult = {
  projectName: string;
  buffer: Buffer;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toKebabCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "stackforge-app";
}

function toPascalCase(value: string): string {
  const parts = value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "Generated";

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function normalizePath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  const cleaned = withSlash.replace(/\/+/g, "/").replace(/\/\/$/, "") || "/";
  const withoutApiPrefix = cleaned.replace(/^\/api(?=\/|$)/, "");
  return withoutApiPrefix.length === 0 ? "/" : withoutApiPrefix;
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, "");
  if (cleaned.length === 0) return fallback;
  if (/^[0-9]/.test(cleaned)) return `${fallback}${cleaned}`;
  return cleaned;
}

function extractEntities(candidate: unknown): EntitySpec[] {
  return readArray(candidate)
    .map((item): EntitySpec | null => {
      if (!isRecord(item)) return null;
      const name = readString(item["name"]);
      if (!name) return null;

      const tableName = readString(item["tableName"], toKebabCase(name).replace(/-/g, "_"));
      const fields = readArray(item["fields"])
        .map((field): EntityFieldSpec | null => {
          if (!isRecord(field)) return null;
          const fieldName = readString(field["name"]);
          const type = readString(field["type"], "string");
          if (!fieldName) return null;

          const parsedField: EntityFieldSpec = {
            name: fieldName,
            type,
            nullable: readBoolean(field["nullable"], false),
          };

          if (readBoolean(field["unique"], false)) {
            parsedField.unique = true;
          }

          const foreignKey = readString(field["foreignKey"]);
          if (foreignKey.length > 0) {
            parsedField.foreignKey = foreignKey;
          }

          return parsedField;
        })
        .filter((field): field is EntityFieldSpec => field !== null);

      if (fields.length === 0) {
        fields.push({ name: "id", type: "string", nullable: false, unique: true });
      }

      return {
        name,
        tableName,
        fields,
        indexes: readArray(item["indexes"]).map((idx) => readString(idx)).filter(Boolean),
      };
    })
    .filter((entity): entity is EntitySpec => entity !== null);
}

function normalizeMethod(value: unknown): RouteSpec["method"] {
  const raw = readString(value, "GET").toUpperCase();
  if (raw === "POST" || raw === "PUT" || raw === "PATCH" || raw === "DELETE") {
    return raw;
  }
  return "GET";
}

function extractRoutes(candidate: unknown): RouteSpec[] {
  return readArray(candidate)
    .map((item): RouteSpec | null => {
      if (!isRecord(item)) return null;
      const path = normalizePath(readString(item["path"], "/"));
      const requestBody = readString(item["requestBody"]);

      const route: RouteSpec = {
        method: normalizeMethod(item["method"]),
        path,
        description: readString(item["description"], "TODO: implement endpoint"),
        auth: readBoolean(item["auth"], false),
        responseType: readString(item["responseType"], "object"),
      };

      if (requestBody.length > 0) {
        route.requestBody = requestBody;
      }

      return route;
    })
    .filter((route): route is RouteSpec => route !== null);
}

function extractFrontendPages(candidate: unknown): FrontendPageSpec[] {
  return readArray(candidate)
    .map((item): FrontendPageSpec | null => {
      if (!isRecord(item)) return null;
      const route = normalizePath(readString(item["route"], "/"));
      const name = readString(item["name"], route === "/" ? "Home" : route.split("/").filter(Boolean).join(" "));

      return {
        route,
        name,
        components: readArray(item["components"]).map((x) => readString(x)).filter(Boolean),
        auth: readBoolean(item["auth"], false),
        description: readString(item["description"], "Generated page"),
      };
    })
    .filter((page): page is FrontendPageSpec => page !== null);
}

function extractPipeline(pipelineOutput: unknown): ExtractedPipeline {
  const root = isRecord(pipelineOutput) ? pipelineOutput : {};
  const primary = isRecord(root["blueprint"]) ? root["blueprint"] : root;
  const schema = isRecord(root["schema"]) ? root["schema"] : {};
  const api = isRecord(root["api"]) ? root["api"] : {};
  const frontend = isRecord(root["frontend"]) ? root["frontend"] : {};
  const devops = isRecord(root["devops"]) ? root["devops"] : {};
  const infraPlan = isRecord(primary["infraPlan"]) ? primary["infraPlan"] : {};
  const stack = isRecord(primary["stack"]) ? primary["stack"] : {};

  const projectName =
    readString(primary["projectName"]) ||
    readString(root["projectName"]) ||
    readString(schema["projectName"]) ||
    "stackforge-app";

  const entities = extractEntities(primary["entities"] ?? schema["entities"]);
  const routePlan = extractRoutes(primary["routePlan"] ?? api["routePlan"] ?? api["routes"]);
  const frontendPages = extractFrontendPages(primary["frontendPages"] ?? frontend["pages"]);

  const dockerfile = readString(devops["dockerfile"]) || undefined;
  const dockerCompose =
    readString(devops["dockerCompose"]) || readString(devops["docker_compose"]) || undefined;

  const infra: InfraSpec = {
    docker: readBoolean(infraPlan["docker"], true),
    envVars: readArray(infraPlan["envVars"] ?? devops["envVars"])
      .map((entry) => readString(entry))
      .filter(Boolean),
  };

  if (dockerfile !== undefined) {
    infra.dockerfile = dockerfile;
  }

  if (dockerCompose !== undefined) {
    infra.dockerCompose = dockerCompose;
  }

  return {
    projectName,
    stack: {
      frontend: readString(stack["frontend"], "react"),
      backend: readString(stack["backend"], "express"),
      database: readString(stack["database"], "postgresql"),
      auth: readString(stack["auth"], "jwt"),
      hosting: readString(stack["hosting"], "docker"),
      packageManager: readString(stack["packageManager"], "npm"),
    },
    entities,
    routePlan,
    frontendPages,
    infra,
  };
}

function mapPrismaType(type: string): string {
  const normalized = type.toLowerCase();
  if (["uuid", "string", "text", "varchar"].includes(normalized)) return "String";
  if (["int", "integer", "number"].includes(normalized)) return "Int";
  if (["float", "double", "decimal"].includes(normalized)) return "Float";
  if (["bool", "boolean"].includes(normalized)) return "Boolean";
  if (["datetime", "timestamp", "date"].includes(normalized)) return "DateTime";
  if (["json", "object"].includes(normalized)) return "Json";
  return "String";
}

function inferPrismaProvider(database: string): string {
  const db = database.toLowerCase();
  if (db.includes("mysql")) return "mysql";
  if (db.includes("sqlite")) return "sqlite";
  if (db.includes("sqlserver") || db.includes("mssql")) return "sqlserver";
  if (db.includes("mongodb")) return "mongodb";
  return "postgresql";
}

function renderPrismaSchema(entities: EntitySpec[], database: string): string {
  const provider = inferPrismaProvider(database);
  const blocks = entities.map((entity) => {
    const modelName = toPascalCase(entity.name);
    const fieldLines = entity.fields.map((field) => {
      const type = mapPrismaType(field.type);
      const optional = field.nullable ? "?" : "";
      const attrs: string[] = [];

      if (field.name.toLowerCase() === "id") {
        attrs.push("@id");
        if (type === "String") {
          attrs.push("@default(uuid())");
        }
      }

      if (field.unique) {
        attrs.push("@unique");
      }

      const line = `  ${field.name} ${type}${optional}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}`;
      if (!field.foreignKey) return line;
      return `${line} // references ${field.foreignKey}`;
    });

    if (!entity.fields.some((field) => field.name.toLowerCase() === "id")) {
      fieldLines.unshift("  id String @id @default(uuid())");
    }

    const indexLines = entity.indexes
      .map((idx) => idx.split(",").map((x) => x.trim()).filter(Boolean))
      .filter((parts) => parts.length > 0)
      .map((parts) => `  @@index([${parts.join(", ")}])`);

    return [
      `model ${modelName} {`,
      ...fieldLines,
      ...indexLines,
      "}",
    ].join("\n");
  });

  return [
    "generator client {",
    "  provider = \"prisma-client-js\"",
    "}",
    "",
    "datasource db {",
    `  provider = \"${provider}\"`,
    "  url      = env(\"DATABASE_URL\")",
    "}",
    "",
    ...blocks,
    "",
  ].join("\n");
}

function groupRoutes(routePlan: RouteSpec[]): GroupedRoutes[] {
  const groups = new Map<string, GroupedRoutes>();

  for (const route of routePlan) {
    const segments = normalizePath(route.path).split("/").filter(Boolean);
    const resource = segments[0] ?? "root";
    const fileName = `${resource}.routes.ts`;
    const routerName = `${toCamelCase(resource)}Router`;
    const subPath = segments.length <= 1 ? "/" : `/${segments.slice(1).join("/")}`;
    const mountPath = resource === "root" ? "/api" : `/api/${resource}`;

    const group = groups.get(resource) ?? {
      resource,
      fileName,
      routerName,
      mountPath,
      routes: [],
    };

    group.routes.push({ ...route, subPath });
    groups.set(resource, group);
  }

  return [...groups.values()].sort((a, b) => a.resource.localeCompare(b.resource));
}

function renderRouteFile(group: GroupedRoutes): string {
  const handlerLines = group.routes.map((route) => {
    const handlerName = sanitizeIdentifier(
      `${route.method.toLowerCase()}_${route.subPath.replace(/[^a-zA-Z0-9]/g, "_")}`,
      "handler",
    );
    const authNote = route.auth ? "(auth required) " : "";

    return [
      `const ${handlerName}: RequestHandler = (_req, res) => {`,
      "  res.status(501).json({",
      `    message: \"${authNote}${route.description}\",`,
      "    status: \"not_implemented\",",
      "  });",
      "};",
      `router.${route.method.toLowerCase()}(\"${route.subPath}\", ${handlerName});`,
      "",
    ].join("\n");
  });

  return [
    "import { Router, type RequestHandler } from \"express\";",
    "",
    "const router = Router();",
    "",
    ...handlerLines,
    `export { router as ${group.routerName} };`,
    "",
  ].join("\n");
}

function renderEntryPoint(projectName: string, groups: GroupedRoutes[]): string {
  const importLines = groups.map(
    (group) => `import { ${group.routerName} } from \"./routes/${group.fileName.replace(/\.ts$/, "")}.js\";`,
  );

  const mountLines = groups.map(
    (group) => `app.use(\"${group.mountPath}\", ${group.routerName});`,
  );

  return [
    'import "dotenv/config";',
    'import express from "express";',
    ...importLines,
    "",
    "const app = express();",
    "const port = Number(process.env.PORT ?? 3001);",
    "",
    "app.use(express.json());",
    'app.get("/healthz", (_req, res) => {',
    '  res.json({ status: "ok", service: "generated-stackforge-app" });',
    "});",
    ...mountLines,
    "",
    "app.listen(port, () => {",
    `  console.log(\"${projectName} server listening on http://localhost:${"${port}"}\");`,
    "});",
    "",
  ].join("\n");
}

function inferDependencies(extracted: ExtractedPipeline): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const dependencies: Record<string, string> = {
    dotenv: "^16.4.7",
    express: "^4.21.2",
  };

  const devDependencies: Record<string, string> = {
    "@types/express": "^4.17.21",
    "@types/node": "^22.13.10",
    typescript: "^5.7.3",
  };

  if (extracted.entities.length > 0) {
    dependencies["@prisma/client"] = "^6.6.0";
    devDependencies["prisma"] = "^6.6.0";
  }

  if (extracted.routePlan.some((route) => route.auth)) {
    dependencies["jsonwebtoken"] = "^9.0.2";
    dependencies["bcryptjs"] = "^2.4.3";
  }

  if (extracted.frontendPages.length > 0 || extracted.stack.frontend.toLowerCase().includes("react")) {
    dependencies["react"] = "^19.0.0";
    dependencies["react-dom"] = "^19.0.0";
  }

  return {
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
    devDependencies: Object.fromEntries(
      Object.entries(devDependencies).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

function renderPackageJson(extracted: ExtractedPipeline): string {
  const { dependencies, devDependencies } = inferDependencies(extracted);

  return JSON.stringify(
    {
      name: toKebabCase(extracted.projectName),
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "tsx watch src/index.ts",
        build: "tsc",
        start: "node dist/index.js",
      },
      dependencies,
      devDependencies: {
        ...devDependencies,
        tsx: "^4.19.2",
      },
    },
    null,
    2,
  );
}

function renderReadme(extracted: ExtractedPipeline): string {
  const hasPrisma = extracted.entities.length > 0;
  const routeCount = extracted.routePlan.length;
  const pageCount = extracted.frontendPages.length;

  return [
    `# ${extracted.projectName}`,
    "",
    "Generated by StackForge file writer.",
    "",
    "## Stack",
    `- Frontend: ${extracted.stack.frontend}`,
    `- Backend: ${extracted.stack.backend}`,
    `- Database: ${extracted.stack.database}`,
    `- Auth: ${extracted.stack.auth}`,
    `- Hosting: ${extracted.stack.hosting}`,
    "",
    "## Included Outputs",
    `- API routes: ${routeCount}`,
    `- Frontend pages: ${pageCount}`,
    `- Entities: ${extracted.entities.length}`,
    "",
    "## Setup",
    "1. Install dependencies: `npm install`",
    hasPrisma ? "2. Configure `DATABASE_URL` and run `npx prisma migrate dev --name init`" : "2. Configure `.env` values",
    hasPrisma ? "3. Generate Prisma client: `npx prisma generate`" : "3. Build the project",
    hasPrisma ? "4. Run in dev mode: `npm run dev`" : "4. Run in dev mode: `npm run dev`",
    "",
  ].join("\n");
}

function renderTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        outDir: "dist",
        rootDir: "src",
        strict: true,
        esModuleInterop: false,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    null,
    2,
  );
}

function renderEnvExample(envVars: string[]): string {
  if (envVars.length === 0) {
    return [
      "PORT=3001",
      "NODE_ENV=development",
      "DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app",
      "JWT_SECRET=change-me",
      "",
    ].join("\n");
  }

  const normalized = envVars.map((entry) => {
    const key = entry.split("=")[0]?.trim() ?? "";
    return key.length > 0 ? `${key}=` : "";
  }).filter(Boolean);

  if (!normalized.some((line) => line.startsWith("PORT="))) {
    normalized.unshift("PORT=3001");
  }
  if (!normalized.some((line) => line.startsWith("NODE_ENV="))) {
    normalized.unshift("NODE_ENV=development");
  }

  return `${normalized.join("\n")}\n`;
}

function renderDockerfile(customDockerfile?: string): string {
  if (customDockerfile && customDockerfile.trim().length > 0) {
    return customDockerfile;
  }

  return [
    "FROM node:22-alpine",
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm install",
    "COPY . .",
    "RUN npm run build",
    "EXPOSE 3001",
    "CMD [\"npm\", \"run\", \"start\"]",
    "",
  ].join("\n");
}

function renderDockerCompose(customCompose?: string): string {
  if (customCompose && customCompose.trim().length > 0) {
    return customCompose;
  }

  return [
    "version: '3.9'",
    "services:",
    "  app:",
    "    build: .",
    "    ports:",
    "      - \"3001:3001\"",
    "    env_file:",
    "      - .env.example",
    "",
  ].join("\n");
}

function renderFrontendPage(page: FrontendPageSpec): string {
  const componentName = sanitizeIdentifier(toPascalCase(page.name), "GeneratedPage");

  return [
    "import React from \"react\";",
    "",
    `export function ${componentName}Page() {`,
    "  return (",
    "    <main style={{ padding: \"2rem\", fontFamily: \"system-ui, sans-serif\" }}>",
    `      <h1>${componentName}</h1>`,
    `      <p>${page.description}</p>`,
    page.auth ? '      <p><strong>Auth:</strong> Required</p>' : '      <p><strong>Auth:</strong> Public</p>',
    "    </main>",
    "  );",
    "}",
    "",
    `export default ${componentName}Page;`,
    "",
  ].join("\n");
}

export async function buildProjectZip(pipelineOutput: unknown): Promise<FileWriterResult> {
  const extracted = extractPipeline(pipelineOutput);
  const groupedRoutes = groupRoutes(extracted.routePlan);

  const zip = new JSZip();
  zip.file("package.json", renderPackageJson(extracted));
  zip.file("README.md", renderReadme(extracted));
  zip.file("tsconfig.json", renderTsConfig());
  zip.file(".gitignore", "node_modules\ndist\n.env\n");
  zip.file(".env.example", renderEnvExample(extracted.infra.envVars));

  if (extracted.entities.length > 0) {
    zip.file("prisma/schema.prisma", renderPrismaSchema(extracted.entities, extracted.stack.database));
  }

  for (const group of groupedRoutes) {
    zip.file(`src/routes/${group.fileName}`, renderRouteFile(group));
  }

  zip.file("src/index.ts", renderEntryPoint(extracted.projectName, groupedRoutes));

  for (const page of extracted.frontendPages) {
    const pageName = sanitizeIdentifier(toPascalCase(page.name), "Page");
    zip.file(`src/pages/${pageName}.tsx`, renderFrontendPage(page));
  }

  if (extracted.infra.docker) {
    zip.file("Dockerfile", renderDockerfile(extracted.infra.dockerfile));
    zip.file("docker-compose.yml", renderDockerCompose(extracted.infra.dockerCompose));
  }

  const projectName = toKebabCase(extracted.projectName);
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  return {
    projectName,
    buffer,
  };
}
