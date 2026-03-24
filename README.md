# StackForge 🏗️

**StackForge** is an AI agent orchestration system designed for full-stack scaffolding. 
Users enter a product idea in plain English, and the system coordinates multiple specialized subagents to generate a structured, full-stack project blueprint (and eventually real code).

Currently, this repository contains the **Core Backend & Orchestration Layer** (v1), which features a clean provider abstraction, strict Zod validation, and real-time Server-Sent Events (SSE) streaming for agent progress.

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
  agents/       # Core Orchestration, 6 Subagents, and LLM Provider mock
  shared/       # Zod Schemas, Constant Enums, and TS Contract Types
  ui/           # Reusable UI primitives stub
  config/       # ESLint/TSConfig stubs
```


