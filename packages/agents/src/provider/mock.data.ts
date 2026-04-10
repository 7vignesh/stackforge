import type {
  PlannerOutput,
  SchemaOutput,
  ApiAgentOutput,
  FrontendOutput,
  DevopsOutput,
  ReviewerOutput,
  CodegenOutput,
  GeneratedSourceFile,
} from "@stackforge/shared";

export function buildPlannerOutput(projectName: string): PlannerOutput {
  return {
    projectName,
    stack: {
      frontend: "React 18 + Vite",
      backend: "Express 4 + TypeScript",
      database: "PostgreSQL 15 + Prisma ORM",
      auth: "JWT (access + refresh) + bcrypt",
      hosting: "Railway (API) + Vercel (web) + Supabase (DB)",
      packageManager: "Bun",
      monorepo: true,
    },
    folderStructure: [
      { path: "apps/api/src/routes", type: "dir", description: "Express route modules" },
      { path: "apps/api/src/controllers", type: "dir", description: "Request/response handlers" },
      { path: "apps/api/src/services", type: "dir", description: "Business logic layer" },
      { path: "apps/api/src/middleware", type: "dir", description: "Auth, error, validation middleware" },
      { path: "apps/api/prisma", type: "dir", description: "Prisma schema and migrations" },
      { path: "apps/web/src/pages", type: "dir", description: "React page components" },
      { path: "apps/web/src/components/ui", type: "dir", description: "Reusable UI primitives" },
      { path: "apps/web/src/hooks", type: "dir", description: "Custom React hooks" },
      { path: "apps/web/src/store", type: "dir", description: "Zustand global state" },
      { path: "apps/web/src/lib/api", type: "dir", description: "Typed fetch-based API client" },
      { path: "packages/shared/src", type: "dir", description: "Shared Zod schemas and TS types" },
    ],
  };
}

export function buildSchemaOutput(): SchemaOutput {
  return {
    entities: [
      {
        name: "User",
        tableName: "users",
        fields: [
          { name: "id", type: "uuid", nullable: false, unique: true },
          { name: "email", type: "varchar(255)", nullable: false, unique: true },
          { name: "passwordHash", type: "text", nullable: false },
          { name: "displayName", type: "varchar(100)", nullable: false },
          { name: "avatarUrl", type: "text", nullable: true },
          { name: "role", type: "enum(admin,member)", nullable: false },
          { name: "createdAt", type: "timestamptz", nullable: false },
          { name: "updatedAt", type: "timestamptz", nullable: false },
        ],
        indexes: ["email"],
      },
      {
        name: "Team",
        tableName: "teams",
        fields: [
          { name: "id", type: "uuid", nullable: false, unique: true },
          { name: "name", type: "varchar(100)", nullable: false },
          { name: "slug", type: "varchar(100)", nullable: false, unique: true },
          { name: "ownerId", type: "uuid", nullable: false, foreignKey: "users.id" },
          { name: "createdAt", type: "timestamptz", nullable: false },
        ],
        indexes: ["slug", "ownerId"],
      },
      {
        name: "Membership",
        tableName: "memberships",
        fields: [
          { name: "id", type: "uuid", nullable: false, unique: true },
          { name: "userId", type: "uuid", nullable: false, foreignKey: "users.id" },
          { name: "teamId", type: "uuid", nullable: false, foreignKey: "teams.id" },
          { name: "role", type: "enum(owner,admin,member)", nullable: false },
          { name: "joinedAt", type: "timestamptz", nullable: false },
        ],
        indexes: ["userId", "teamId"],
      },
      {
        name: "Task",
        tableName: "tasks",
        fields: [
          { name: "id", type: "uuid", nullable: false, unique: true },
          { name: "title", type: "varchar(255)", nullable: false },
          { name: "description", type: "text", nullable: true },
          { name: "status", type: "enum(todo,in_progress,done,cancelled)", nullable: false },
          { name: "priority", type: "enum(low,medium,high,urgent)", nullable: false },
          { name: "assigneeId", type: "uuid", nullable: true, foreignKey: "users.id" },
          { name: "teamId", type: "uuid", nullable: false, foreignKey: "teams.id" },
          { name: "dueAt", type: "timestamptz", nullable: true },
          { name: "createdById", type: "uuid", nullable: false, foreignKey: "users.id" },
          { name: "createdAt", type: "timestamptz", nullable: false },
          { name: "updatedAt", type: "timestamptz", nullable: false },
        ],
        indexes: ["teamId", "assigneeId", "status", "priority"],
      },
      {
        name: "Comment",
        tableName: "comments",
        fields: [
          { name: "id", type: "uuid", nullable: false, unique: true },
          { name: "body", type: "text", nullable: false },
          { name: "taskId", type: "uuid", nullable: false, foreignKey: "tasks.id" },
          { name: "authorId", type: "uuid", nullable: false, foreignKey: "users.id" },
          { name: "createdAt", type: "timestamptz", nullable: false },
          { name: "updatedAt", type: "timestamptz", nullable: false },
        ],
        indexes: ["taskId", "authorId"],
      },
    ],
    relationships: [
      { from: "User", to: "Team", type: "many-to-many", description: "Users belong to many teams via Membership" },
      { from: "Team", to: "Task", type: "one-to-many", description: "A team owns many tasks" },
      { from: "User", to: "Task", type: "one-to-many", description: "A user can be assigned many tasks" },
      { from: "Task", to: "Comment", type: "one-to-many", description: "A task has many comments" },
      { from: "User", to: "Comment", type: "one-to-many", description: "A user authors many comments" },
    ],
  };
}

export function buildApiOutput(): ApiAgentOutput {
  return {
    routePlan: [
      { method: "POST", path: "/auth/register", description: "Register with email and password", auth: false, requestBody: "RegisterDto", responseType: "AuthTokensResponse" },
      { method: "POST", path: "/auth/login", description: "Authenticate and receive JWT pair", auth: false, requestBody: "LoginDto", responseType: "AuthTokensResponse" },
      { method: "POST", path: "/auth/refresh", description: "Exchange refresh token for new access token", auth: false, requestBody: "RefreshTokenDto", responseType: "AccessTokenResponse" },
      { method: "POST", path: "/auth/logout", description: "Revoke refresh token", auth: true, responseType: "void" },
      { method: "GET", path: "/users/me", description: "Get authenticated user profile", auth: true, responseType: "UserProfile" },
      { method: "PATCH", path: "/users/me", description: "Update display name or avatar URL", auth: true, requestBody: "UpdateProfileDto", responseType: "UserProfile" },
      { method: "GET", path: "/teams", description: "List teams the authenticated user belongs to", auth: true, responseType: "Team[]" },
      { method: "POST", path: "/teams", description: "Create a new team", auth: true, requestBody: "CreateTeamDto", responseType: "Team" },
      { method: "GET", path: "/teams/:teamId", description: "Get team details with member count", auth: true, responseType: "TeamDetail" },
      { method: "PATCH", path: "/teams/:teamId", description: "Update team name (owner only)", auth: true, requestBody: "UpdateTeamDto", responseType: "Team" },
      { method: "DELETE", path: "/teams/:teamId", description: "Delete team and cascade tasks (owner only)", auth: true, responseType: "void" },
      { method: "GET", path: "/teams/:teamId/members", description: "List members with roles", auth: true, responseType: "Membership[]" },
      { method: "POST", path: "/teams/:teamId/members", description: "Invite user to team by email", auth: true, requestBody: "InviteMemberDto", responseType: "Membership" },
      { method: "PATCH", path: "/teams/:teamId/members/:userId", description: "Change member role (admin only)", auth: true, requestBody: "UpdateRoleDto", responseType: "Membership" },
      { method: "DELETE", path: "/teams/:teamId/members/:userId", description: "Remove member from team", auth: true, responseType: "void" },
      { method: "GET", path: "/teams/:teamId/tasks", description: "List tasks with filters: status, priority, assigneeId", auth: true, responseType: "Task[]" },
      { method: "POST", path: "/teams/:teamId/tasks", description: "Create a task in a team", auth: true, requestBody: "CreateTaskDto", responseType: "Task" },
      { method: "GET", path: "/tasks/:taskId", description: "Get full task detail with comments", auth: true, responseType: "TaskDetail" },
      { method: "PATCH", path: "/tasks/:taskId", description: "Update task fields (status, priority, assignee, due date)", auth: true, requestBody: "UpdateTaskDto", responseType: "Task" },
      { method: "DELETE", path: "/tasks/:taskId", description: "Delete task (creator or team admin)", auth: true, responseType: "void" },
      { method: "GET", path: "/tasks/:taskId/comments", description: "List comments on a task", auth: true, responseType: "Comment[]" },
      { method: "POST", path: "/tasks/:taskId/comments", description: "Add a comment to a task", auth: true, requestBody: "CreateCommentDto", responseType: "Comment" },
      { method: "DELETE", path: "/tasks/:taskId/comments/:commentId", description: "Delete own comment", auth: true, responseType: "void" },
    ],
  };
}

export function buildFrontendOutput(): FrontendOutput {
  return {
    frontendPages: [
      { route: "/login", name: "LoginPage", components: ["LoginForm", "AuthLayout", "SocialLoginButtons"], auth: false, description: "Email/password login with JWT storage" },
      { route: "/register", name: "RegisterPage", components: ["RegisterForm", "AuthLayout"], auth: false, description: "Email, display name, and password registration" },
      { route: "/dashboard", name: "DashboardPage", components: ["TaskSummaryCard", "TeamList", "RecentActivityFeed", "AppLayout"], auth: true, description: "Overview of tasks across all teams" },
      { route: "/teams", name: "TeamsPage", components: ["TeamCard", "CreateTeamModal", "AppLayout"], auth: true, description: "List and create teams" },
      { route: "/teams/:teamId", name: "TeamDetailPage", components: ["MemberList", "InviteMemberModal", "TeamSettingsPanel", "AppLayout"], auth: true, description: "Team members and settings" },
      { route: "/teams/:teamId/tasks", name: "TaskBoardPage", components: ["KanbanBoard", "TaskColumn", "TaskCard", "TaskFilterBar", "CreateTaskModal", "AppLayout"], auth: true, description: "Kanban task board with drag-and-drop columns" },
      { route: "/tasks/:taskId", name: "TaskDetailPage", components: ["TaskHeader", "TaskMetaPanel", "CommentThread", "CommentInput", "AppLayout"], auth: true, description: "Full task view with comments" },
      { route: "/profile", name: "ProfilePage", components: ["ProfileForm", "AvatarUpload", "AppLayout"], auth: true, description: "Edit display name and avatar" },
      { route: "*", name: "NotFoundPage", components: ["ErrorLayout"], auth: false, description: "404 fallback" },
    ],
  };
}

export function buildDevopsOutput(projectName: string): DevopsOutput {
  return {
    infraPlan: {
      ci: [
        "GitHub Actions — typecheck on PR",
        "GitHub Actions — lint on PR",
        "GitHub Actions — unit tests on PR",
        "GitHub Actions — build on push to main",
        `GitHub Actions — deploy API (${projectName}) to Railway on merge to main`,
        `GitHub Actions — deploy web (${projectName}) to Vercel on merge to main`,
      ],
      docker: true,
      deployment: [
        "API: Railway.app — auto-deploy from GitHub main branch",
        "Web: Vercel — preview on PR, production on main merge",
        "Database: Supabase PostgreSQL 15 — managed with connection pooler (pgBouncer)",
        "Migrations: Prisma Migrate — run prisma migrate deploy in CI before API start",
      ],
      envVars: [
        "DATABASE_URL",
        "JWT_SECRET",
        "JWT_REFRESH_SECRET",
        "JWT_ACCESS_EXPIRY",
        "JWT_REFRESH_EXPIRY",
        "PORT",
        "NODE_ENV",
        "CORS_ORIGIN",
        "VITE_API_URL",
      ],
    },
    generatedFilesPlan: [
      { path: "apps/api/prisma/schema.prisma", generator: "schema-agent", description: "Prisma data model — all 5 entities with relations" },
      { path: "apps/api/src/routes/auth.ts", generator: "api-agent", description: "Auth route handlers: register, login, refresh, logout" },
      { path: "apps/api/src/routes/teams.ts", generator: "api-agent", description: "Teams CRUD and membership management routes" },
      { path: "apps/api/src/routes/tasks.ts", generator: "api-agent", description: "Tasks CRUD with team-scoped filtering" },
      { path: "apps/api/src/routes/comments.ts", generator: "api-agent", description: "Comment create and delete routes" },
      { path: "apps/api/src/middleware/auth.middleware.ts", generator: "api-agent", description: "JWT access-token verification middleware" },
      { path: "apps/web/src/pages/LoginPage.tsx", generator: "frontend-agent", description: "Login page component" },
      { path: "apps/web/src/pages/TaskBoardPage.tsx", generator: "frontend-agent", description: "Kanban board page with drag-and-drop" },
      { path: "apps/web/src/lib/api/client.ts", generator: "frontend-agent", description: "Typed fetch client with automatic token refresh on 401" },
      { path: ".github/workflows/ci.yml", generator: "devops-agent", description: "Full GitHub Actions CI pipeline" },
      { path: "docker-compose.yml", generator: "devops-agent", description: "Local dev with PostgreSQL and pgAdmin" },
    ],
  };
}

export function buildReviewerOutput(): ReviewerOutput {
  return {
    reviewerNotes: [
      { severity: "warning", agent: "reviewer", note: "No rate limiting on POST /auth/register and POST /auth/login — add express-rate-limit before production" },
      { severity: "warning", agent: "reviewer", note: "Membership.role and User.role are separate enums — consider a unified Role enum in packages/shared to prevent drift" },
      { severity: "info", agent: "reviewer", note: "Task deletion is hard delete — add deletedAt (soft delete) if audit trails or undo functionality is required" },
      { severity: "info", agent: "reviewer", note: "No PATCH on comments — add /tasks/:taskId/comments/:commentId PATCH if inline editing is needed" },
      { severity: "warning", agent: "reviewer", note: "CORS_ORIGIN must be set explicitly; wildcard '*' with credentials will be rejected by browsers" },
      { severity: "info", agent: "reviewer", note: "GET /teams/:teamId/tasks has no pagination — add cursor-based pagination before launch to handle large task lists" },
      { severity: "warning", agent: "reviewer", note: "No refresh token rotation strategy defined — implement single-use refresh tokens to prevent token reuse attacks" },
    ],
  };
}

export function buildCodegenOutput(projectName: string): { generatedSourceFiles: GeneratedSourceFile[] } {
  const appName = projectName.trim().length > 0 ? projectName : "generated-app";

  return {
    generatedSourceFiles: [
      {
        path: "README.md",
        language: "markdown",
        content: `# ${appName}\n\nGenerated by StackForge codegen agent.`,
      },
      {
        path: "package.json",
        language: "json",
        content: JSON.stringify({
          name: appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "generated-app",
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsc",
            start: "node dist/index.js",
          },
          dependencies: {
            express: "^4.21.2",
            dotenv: "^16.4.7",
          },
          devDependencies: {
            typescript: "^5.7.3",
            tsx: "^4.19.2",
            "@types/node": "^22.13.10",
            "@types/express": "^4.17.21",
          },
        }, null, 2),
      },
      {
        path: "tsconfig.json",
        language: "json",
        content: JSON.stringify({
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            rootDir: "src",
            outDir: "dist",
            strict: true,
            skipLibCheck: true,
          },
          include: ["src"],
        }, null, 2),
      },
      {
        path: "src/index.ts",
        language: "typescript",
        content: [
          'import "dotenv/config";',
          'import express from "express";',
          "",
          "const app = express();",
          "const port = Number(process.env.PORT ?? 3001);",
          "",
          "app.use(express.json());",
          'app.get("/healthz", (_req, res) => {',
          '  res.json({ status: "ok", service: "stackforge-generated" });',
          "});",
          "",
          "app.listen(port, () => {",
          '  console.log(`Server listening on http://localhost:${port}`);',
          "});",
          "",
        ].join("\n"),
      },
    ],
  };
}
