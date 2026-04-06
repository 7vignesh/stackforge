# StackForge 🏗️

**StackForge** is an AI agent orchestration system designed for full-stack scaffolding. 
Users enter a product idea in plain English, and the system coordinates multiple specialized subagents to generate a structured, full-stack project blueprint (and eventually real code).

Currently, this repository contains the **Core Backend & Orchestration Layer** (v1), which features a clean provider abstraction, strict Zod validation, and real-time Server-Sent Events (SSE) streaming for agent progress.

The backend runs on **real OpenRouter provider calls** with per-agent token optimization (input compression, output caps, and budget guardrails).

---

## 🚀 Tech Stack & Tools Needed

Before you begin, ensure you have the following installed on your machine:

- **[Bun](https://bun.sh/)** (v1.3+): JavaScript runtime, package manager, and test runner.
- **[Turborepo](https://turbo.build/)**: High-performance build system for TypeScript monorepos.
- **Node.js** (v22+): For broad compatibility, though Bun executes the backend.
- **Git**: For version control.

**Monorepo Details:**
- **Language**: TypeScript (Strict Mode)
- **Backend Framework**: Express
- **Realtime**: Server-Sent Events (SSE)
- **Validation & Modeling**: Zod 

---

## 🛠️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/7vignesh/stackforge.git
   cd stackforge
   ```

2. **Install dependencies:**
   Bun handles all workspace linking seamlessly:
   ```bash
   bun install
   ```
   *(This will also set up Husky pre-commit hooks automatically).*

3. **Start the API Server (Development Mode):**
   ```bash
   cd apps/api
   bun run dev
   ```
   *The server will start on http://localhost:3001.*

4. **Run the Interactive Demo:**
   To see the AI orchestration pipeline stream its results in real-time, open a **second terminal** and run:
   ```bash
   bun run scripts/demo.ts
   ```
   *You can also pass a custom prompt:*
   ```bash
   bun run scripts/demo.ts --prompt "Build a CRM for real estate agents with PostgreSQL"
   ```

---

## 🧪 Testing

The repository uses Bun's incredibly fast, built-in native test runner (`bun:test`).

**Run the API Integration Tests:**
```bash
cd apps/api
bun test
```

**Run Tests Across the Entire Monorepo:**
```bash
bun run test
```
*Turborepo will execute the `"test"` script in every package and cache the results.*

### Pre-commit Hooks (Husky)
To ensure the repository remains stable, a git pre-commit hook is fully configured. 
Whenever you run `git commit`, the system automatically runs:
- `turbo run typecheck`: Type-checks all packages without emitting files (`tsc --noEmit`).
- `turbo run test`: Runs the test suites.

If any of these fail, the commit is aborted.



### Monorepo Structure & Ownership

```text
apps/
  api/          # Primary Backend (Express + Orchestrator bridge)
  web/          # Frontend Web App (React/Next.js stub) 

packages/
   agents/       # Core Orchestration, 6 Subagents, OpenRouter provider, token optimizer
  shared/       # Zod Schemas, Constant Enums, and TS Contract Types
  ui/           # Reusable UI primitives stub
  config/       # ESLint/TSConfig stubs
```

---

## ⚙️ OpenRouter Runtime Configuration

Set these variables in `apps/api/.env`:

```bash
STACKFORGE_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key_here
OPENROUTER_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
OPENROUTER_APP_NAME=stackforge-api
OPENROUTER_APP_URL=http://localhost:3001
```

`STACKFORGE_PROVIDER` supports:
- `openrouter`: forces real LLM execution (requires `OPENROUTER_API_KEY`)
- `mock`: forces deterministic offline agent responses
- omitted/`auto`: uses `openrouter` when API key is present, otherwise `mock`

Runtime/provider health is exposed at:
- `GET /api/runtime`

---

## 📉 Token Tuning Guide

Per-agent tuning lives in `packages/agents/src/config/agent.configs.ts`.

- `maxInputTokens`: hard input cap used by optimizer compression.
- `maxOutputTokens`: maximum completion tokens requested from provider.
- `minOutputTokens`: minimum output budget required after compression.
- `tokenBudget`: total budget target used to derive dynamic output caps.
- `compressionLevel`: default compression aggressiveness (`low` / `medium` / `high`).
- `budgetOverflowRetries`: number of extra compression passes before fail-fast.

**Suggested workflow:**
1. Run 3–5 representative prompts.
2. Inspect per-agent SSE `agent_completed` telemetry.
3. Lower `maxInputTokens` or raise `compressionLevel` for agents with high `inputTokens`.
4. Lower `maxOutputTokens` for agents with consistently low `outputTokens`.
5. Raise `minOutputTokens` only if quality drops from over-compression.
6. Adjust `tokenBudget` to set overall cost/quality tradeoff for the entire orchestration.