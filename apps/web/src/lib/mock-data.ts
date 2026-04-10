import type { Blueprint } from "./api";

export const MOCK_BLUEPRINT: Blueprint = {
  projectName: "invoice-saas",
  generatedAt: new Date().toISOString(),
  stack: {
    frontend: "react",
    backend: "express",
    database: "postgres",
    auth: "jwt",
    hosting: "docker + railway",
    packageManager: "bun",
    monorepo: true,
  },
  folderStructure: [
    { path: "apps", type: "dir", description: "Application packages" },
    { path: "apps/web", type: "dir", description: "React frontend" },
    { path: "apps/web/src", type: "dir" },
    { path: "apps/web/src/pages", type: "dir" },
    { path: "apps/web/src/pages/Dashboard.tsx", type: "file", description: "Main dashboard view" },
    { path: "apps/web/src/pages/Invoices.tsx", type: "file", description: "Invoice list & creation" },
    { path: "apps/web/src/pages/Login.tsx", type: "file", description: "Auth login page" },
    { path: "apps/api", type: "dir", description: "Express backend" },
    { path: "apps/api/src", type: "dir" },
    { path: "apps/api/src/routes", type: "dir" },
    { path: "apps/api/src/routes/invoices.ts", type: "file", description: "Invoice CRUD routes" },
    { path: "apps/api/src/routes/auth.ts", type: "file", description: "Auth endpoints" },
    { path: "apps/api/src/models", type: "dir" },
    { path: "apps/api/src/models/User.ts", type: "file" },
    { path: "apps/api/src/models/Invoice.ts", type: "file" },
    { path: "packages", type: "dir" },
    { path: "packages/shared", type: "dir", description: "Shared types & utils" },
    { path: "docker-compose.yml", type: "file", description: "Docker orchestration" },
    { path: "Dockerfile", type: "file", description: "Production container" },
    { path: ".github/workflows/ci.yml", type: "file", description: "CI pipeline" },
  ],
  entities: [
    {
      name: "User",
      tableName: "users",
      fields: [
        { name: "id", type: "uuid", nullable: false, unique: true },
        { name: "email", type: "varchar(255)", nullable: false, unique: true },
        { name: "passwordHash", type: "text", nullable: false },
        { name: "fullName", type: "varchar(100)", nullable: false },
        { name: "role", type: "enum('admin','user')", nullable: false },
        { name: "createdAt", type: "timestamp", nullable: false },
      ],
      indexes: ["idx_users_email"],
    },
    {
      name: "Invoice",
      tableName: "invoices",
      fields: [
        { name: "id", type: "uuid", nullable: false, unique: true },
        { name: "userId", type: "uuid", nullable: false, foreignKey: "users.id" },
        { name: "clientName", type: "varchar(200)", nullable: false },
        { name: "amount", type: "decimal(10,2)", nullable: false },
        { name: "currency", type: "varchar(3)", nullable: false },
        { name: "status", type: "enum('draft','sent','paid','overdue')", nullable: false },
        { name: "dueDate", type: "date", nullable: false },
        { name: "createdAt", type: "timestamp", nullable: false },
      ],
      indexes: ["idx_invoices_user_id", "idx_invoices_status"],
    },
    {
      name: "Payment",
      tableName: "payments",
      fields: [
        { name: "id", type: "uuid", nullable: false, unique: true },
        { name: "invoiceId", type: "uuid", nullable: false, foreignKey: "invoices.id" },
        { name: "stripePaymentId", type: "varchar(255)", nullable: false },
        { name: "amount", type: "decimal(10,2)", nullable: false },
        { name: "paidAt", type: "timestamp", nullable: false },
      ],
    },
  ],
  relationships: [
    { from: "User", to: "Invoice", type: "one-to-many", description: "A user can have many invoices" },
    { from: "Invoice", to: "Payment", type: "one-to-many", description: "An invoice can have multiple payments" },
  ],
  routePlan: [
    { method: "POST", path: "/api/auth/register", description: "Register a new user", auth: false, requestBody: "{ email, password, fullName }", responseType: "{ user, token }" },
    { method: "POST", path: "/api/auth/login", description: "Login and get JWT", auth: false, requestBody: "{ email, password }", responseType: "{ token }" },
    { method: "GET", path: "/api/invoices", description: "List user invoices", auth: true, responseType: "Invoice[]" },
    { method: "POST", path: "/api/invoices", description: "Create a new invoice", auth: true, requestBody: "{ clientName, amount, currency, dueDate }", responseType: "Invoice" },
    { method: "GET", path: "/api/invoices/:id", description: "Get invoice detail", auth: true, responseType: "Invoice" },
    { method: "PATCH", path: "/api/invoices/:id", description: "Update invoice status", auth: true, requestBody: "{ status }", responseType: "Invoice" },
    { method: "DELETE", path: "/api/invoices/:id", description: "Delete a draft invoice", auth: true, responseType: "{ success: boolean }" },
    { method: "POST", path: "/api/invoices/:id/pay", description: "Process Stripe payment", auth: true, requestBody: "{ paymentMethodId }", responseType: "Payment" },
    { method: "GET", path: "/api/dashboard/stats", description: "Dashboard summary stats", auth: true, responseType: "{ totalRevenue, pendingInvoices, paidCount }" },
  ],
  frontendPages: [
    { route: "/login", name: "Login", components: ["LoginForm", "AuthLayout"], auth: false, description: "User authentication page" },
    { route: "/dashboard", name: "Dashboard", components: ["StatsCards", "RevenueChart", "RecentInvoices"], auth: true, description: "Overview with revenue stats and recent activity" },
    { route: "/invoices", name: "Invoices", components: ["InvoiceTable", "FilterBar", "CreateInvoiceModal"], auth: true, description: "Invoice list with filters and creation" },
    { route: "/invoices/:id", name: "Invoice Detail", components: ["InvoiceHeader", "LineItems", "PaymentHistory", "PayButton"], auth: true, description: "Single invoice view with payment" },
    { route: "/settings", name: "Settings", components: ["ProfileForm", "BillingInfo"], auth: true, description: "User profile and billing settings" },
  ],
  infraPlan: {
    ci: ["lint", "typecheck", "test", "build"],
    docker: true,
    deployment: ["Railway (API)", "Vercel (Web)", "Neon (Postgres)"],
    envVars: ["DATABASE_URL", "JWT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  generatedFilesPlan: [
    { path: "docker-compose.yml", generator: "devops", description: "Local dev with Postgres + API" },
    { path: "Dockerfile", generator: "devops", description: "Multi-stage production build" },
    { path: ".github/workflows/ci.yml", generator: "devops", description: "GitHub Actions CI pipeline" },
    { path: "apps/api/prisma/schema.prisma", generator: "schema", description: "Prisma schema with all entities" },
  ],
  reviewerNotes: [
    { severity: "info", agent: "reviewer", note: "Consider adding rate limiting to auth endpoints to prevent brute force attacks." },
    { severity: "warning", agent: "reviewer", note: "Stripe webhook endpoint should verify webhook signatures to prevent spoofed events." },
    { severity: "info", agent: "reviewer", note: "Add pagination to GET /api/invoices for users with large invoice volumes." },
    { severity: "error", agent: "reviewer", note: "Missing CORS configuration — frontend and API are on different origins in production." },
  ],
};

// ─── Demo simulation ──────────────────────────────────────────────────────────

interface DemoSSEEvent {
  type: string;
  jobId: string;
  timestamp: string | number;
  agent?: string;
  agentId?: string;
  token?: string;
  fullOutput?: unknown;
  payload: Record<string, unknown>;
}

const AGENT_SEQUENCE = ["planner", "schema", "api", "frontend", "devops", "reviewer"] as const;

export function runDemoSimulation(
  jobId: string,
  onEvent: (event: DemoSSEEvent) => void,
  onComplete: () => void,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  function schedule(fn: () => void, delayMs: number) {
    const t = setTimeout(() => {
      if (!cancelled) fn();
    }, delayMs);
    timers.push(t);
  }

  // job_created at t=0
  schedule(() => {
    onEvent({
      type: "job_created",
      jobId,
      timestamp: new Date().toISOString(),
      payload: { prompt: "Demo project", projectName: "invoice-saas" },
    });
  }, 200);

  let cumulativeDelay = 500;

  AGENT_SEQUENCE.forEach((agent, i) => {
    const startDelay = cumulativeDelay;
    const runDuration = 1200 + Math.random() * 1800; // 1.2s – 3s per agent
    const endDelay = startDelay + runDuration;

    // agent_started
    schedule(() => {
      onEvent({
        type: "agent_started",
        jobId,
        timestamp: new Date().toISOString(),
        agent,
        payload: {},
      });
    }, startDelay);

    // agent_completed
    const tokenBursts = [
      `> ${agent}: preparing response...\n`,
      `> ${agent}: generating structured plan...\n`,
      `> ${agent}: validating output schema...\n`,
    ];

    tokenBursts.forEach((token, tokenIndex) => {
      schedule(() => {
        onEvent({
          type: "agent_token",
          jobId,
          timestamp: Date.now(),
          agentId: agent,
          token,
          payload: {},
        });
      }, startDelay + 180 + tokenIndex * 190);
    });

    schedule(() => {
      onEvent({
        type: "agent_complete",
        jobId,
        timestamp: Date.now(),
        agentId: agent,
        fullOutput: { message: `${agent} output complete` },
        payload: {},
      });
    }, endDelay - 40);

    schedule(() => {
      onEvent({
        type: "agent_completed",
        jobId,
        timestamp: new Date().toISOString(),
        agent,
        payload: {
          durationMs: Math.round(runDuration),
          cached: false,
          inputTokens: 800 + Math.floor(Math.random() * 400),
          outputTokens: 400 + Math.floor(Math.random() * 300),
          totalTokens: 1200 + Math.floor(Math.random() * 700),
          tokensUsed: 1200 + Math.floor(Math.random() * 700),
          estimatedInputTokens: 900,
          compressionPasses: 0,
          providerInputTokens: 800,
          providerOutputTokens: 400,
          model: "meta-llama/llama-3.1-8b-instruct",
        },
      });
    }, endDelay);

    cumulativeDelay = endDelay + 300; // small gap between agents
  });

  // job_completed
  schedule(() => {
    onEvent({
      type: "job_completed",
      jobId,
      timestamp: new Date().toISOString(),
      payload: { durationMs: Math.round(cumulativeDelay) },
    });
    onComplete();
  }, cumulativeDelay + 200);

  // Return a cancel function
  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}
