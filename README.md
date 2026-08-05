# StackForge — Loop Engine

A **loop engine for AI coding agents** that enforces structured progress through goals, milestones, and verifiable gates. Instead of letting an agent free-wheel, StackForge ensures every claim of "done" is backed by real evidence — commands that exit 0, not sentences that sound right.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  MCP Server                      │
│            (apps/mcp — 14 tools)                 │
├─────────────────────────────────────────────────┤
│                 Loop Core                        │
│         (packages/loop-core — engine)            │
│                                                  │
│  ┌──────────┐  ┌────────┐  ┌────────────────┐  │
│  │  State   │  │ Gates  │  │    Memory      │  │
│  │  Store   │  │ Runner │  │  (decisions,   │  │
│  │ (SQLite) │  │        │  │  facts, etc.)  │  │
│  └──────────┘  └────────┘  └────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Packages

| Path | Description |
|------|-------------|
| `packages/loop-core` | The engine: state management, gate execution, memory, and dependency rules |
| `apps/mcp` | MCP server exposing the engine as tools to any AI coding agent |

## Core Concepts

### Loops
A loop represents a single goal being worked through. It progresses through milestones and can be active, paused, done, failed, or abandoned.

### Milestones
Discrete checkpoints within a loop. Each milestone must be validated by gates before it can be marked done. Milestones support dependency ordering — a milestone can declare it depends on others.

### Gates
Shell commands that produce facts. A gate is a command (e.g. `bun test`, `tsc --noEmit`) with a timeout and a pass/fail condition. If it exits 0, it passes. Gates are defined in `stackforge.json` — never accepted from MCP callers — ensuring a prompt-injected agent cannot gain arbitrary code execution.

### Memory
Persistent recall across sessions. Memories are categorized as:
- **Decision** — a choice that constrains future work
- **Fact** — a durable truth about the project
- **Pattern** — a reusable approach
- **Built** — a capability that exists and must not be rebuilt
- **Gotcha** — a trap discovered the hard way

### Existence Pre-flight
Before starting work on a milestone, the engine checks whether it's already built (fully, partially, or not at all). This prevents an agent from rebuilding something it shipped three sessions ago and has since forgotten.

## Configuration

Create a `stackforge.json` in your project root:

```json
{
  "gates": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "lint": {
      "command": "eslint .",
      "blocking": false,
      "order": 50
    }
  }
}
```

Gates support shorthand (`"name": "command"`) or full config with `timeoutMs`, `order`, and `blocking` options.

## MCP Tools

The MCP server exposes 14 tools for agent integration:

| Tool | Purpose |
|------|---------|
| `loop_start` | Begin a new goal loop |
| `loop_plan` | Define milestones for the active loop |
| `loop_status` | Get current loop state |
| `loop_resume` | Resume a paused loop |
| `loop_preflight` | Run existence check on a milestone |
| `loop_checkpoint` | Record an iteration's progress |
| `loop_gate` | Run a specific gate by name |
| `loop_validate` | Run all gates for the current milestone |
| `loop_done` | Mark a milestone as complete (requires passing gates) |
| `loop_skip` | Skip a milestone with a reason |
| `loop_remember` | Store a memory entry |
| `loop_recall` | Search memories by query |
| `loop_history` | View iteration history |
| `loop_pause` | Pause the active loop |

## Getting Started

### Prerequisites
- [Bun](https://bun.sh/) >= 1.3.0

### Install dependencies
```bash
bun install
```

### Run loop-core tests
```bash
cd packages/loop-core
bun test
```

### Start MCP server (development)
```bash
cd apps/mcp
bun run dev
```

### Type-check
```bash
bun run typecheck
```

## Design Principles

1. **The engine contains no LLM calls.** It persists state, runs commands, and enforces rules. Intelligence comes from the agent above it.
2. **Facts over claims.** A milestone is not done until a gate proves it.
3. **Security boundary.** Gate commands come from `stackforge.json` in version control, never from MCP callers.
4. **Survive restarts.** All state is plain data persisted to SQLite. A process exit loses nothing.
5. **Same logic everywhere.** CLI and MCP server share `loop-core` — no duplicated decisions.

## License

Private — not published.
