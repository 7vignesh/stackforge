# HANDOFF — `feat/loop-engine`

Written at the point work stopped. Read this top to bottom before touching the branch.

---

## 1. TL;DR

This branch begins rebuilding StackForge from a **full-stack code generator** into a
**loop engine for AI coding agents**. It adds one new package and one new app:

| Path | What | State |
|---|---|---|
| `packages/loop-core/` | The engine: state, gates, memory, dependency rules | **Complete and green** — 161 tests passing, `tsc` clean |
| `apps/mcp/` | MCP server exposing the engine as 14 tools | **Written, does not compile** — 1 known type error, zero tests |
| `apps/cli/` | Companion CLI | **Does not exist.** Planned only |

**Nothing is committed.** All work is uncommitted in the working tree on
`feat/loop-engine`. The branch was cut from `main` at `966fa36 chore: sync bun.lock`.

The old v1 code (`packages/agents/`, `apps/api/`, `apps/web/`) is **untouched**. The
decision to delete the code-generation agents was made but never executed. Both systems
coexist on this branch right now.

### Last verified state

Everything below was confirmed by actually running it:

```
packages/loop-core:  bunx tsc --noEmit   → clean
packages/loop-core:  bun test            → 161 pass, 0 fail, 293 expect(), 5 files
apps/mcp:            bunx tsc --noEmit   → 1 error (server.ts:72)
```

After that point I made one edit to `apps/mcp/src/tools.ts` attempting to fix
`server.ts:72`, and **never re-ran the compiler**. The shell stopped returning output
before I could verify. So:

- Treat `packages/loop-core` as trustworthy — its green result is real and reproducible.
- Treat `apps/mcp` as unverified. The final edit may or may not have applied. **Run
  `bunx tsc --noEmit` in `apps/mcp` first thing.**

---

## 2. Why this exists — the reasoning

Read this section even if you're tempted to skip to the code. The design only makes sense
with the argument behind it.

### The pivot

StackForge v1 took a prompt ("build a CRM for real estate agents") and ran six specialised
agents — planner, schema, api, frontend, devops, reviewer — to emit a blueprint plus
generated source files. It worked. It also had no reason to exist: anyone with Claude Code
or Cursor already generates code, with full repo context, better.

Worse, v1's "reviewer" agent reviewed the *plan*. Nothing ever ran `tsc`. Nothing ran
`npm test`. The system could emit a project that did not compile and call it done.

The conclusion driving this branch: **do not compete with the model at code generation.**
That capability is commoditising every few months. Build the thing models structurally
cannot do alone.

### What models can't do alone

1. **Loop.** They do one pass and stop.
2. **Judge themselves.** The maker is the worst possible checker — it has its own reasoning
   in context, so the work looks correct to it.
3. **Remember.** New session, empty context, project knowledge gone.
4. **Know when to stop.** No budget or convergence awareness.
5. **Know what already exists.** So they rebuild it, slightly differently, and it drifts.
6. **Prove anything.** "The tests should now pass" is a sentence, not a fact.

`genesis-kit` (github.com/ayush488-glitch/genesis-kit) identified the same list and is
worth reading for context. Its weakness is delivery: it's markdown files plus a shell
script, and enforcement is "we wrote instructions and hope the agent follows them." In
practice agents ignore `CLAUDE.md`. This branch is the same insight built as software that
can actually refuse.

### The design constraint that shapes everything

**No API keys. No network calls. No LLM inside the engine.**

The user's own agent supplies all intelligence. `loop-core` cannot plan, cannot write code,
cannot judge quality. It persists what happened, runs shell commands, and refuses to let a
milestone be called done without evidence. That's the entire product.

This is why there is no verifier model, no provider layer, no `OPENROUTER_API_KEY`. An
earlier design had a separate "checker" LLM for maker≠checker separation. It was dropped:
if `tsc` passes, tests pass, and lint passes, that *is* verification, and the compiler is a
better judge than any model. It doesn't hallucinate and it doesn't sympathise.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  User's coding agent (Claude Code / Cursor / Windsurf)    │
│  Does ALL thinking, planning, and code writing.          │
└───────────────────────┬──────────────────────────────────┘
                        │ MCP tool calls (stdio, JSON-RPC)
┌───────────────────────▼──────────────────────────────────┐
│  apps/mcp — 14 tools. Thin translation layer only.       │
│  Parses args → calls engine → formats text response.     │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────┐
│  packages/loop-core — ALL rules live here                │
│                                                          │
│   LoopEngine      the public API; owns every refusal      │
│   StateStore      SQLite persistence + invariants         │
│   gates/runner    spawns real subprocesses, reads exits   │
│   config          stackforge.json parsing (zod)           │
│   config-loader   walks up to find the project root       │
└───────────────────────┬──────────────────────────────────┘
                        │
              .stackforge/loop.db  (SQLite, WAL, local)
```

**The split is deliberate and load-bearing.** Every rule is in `loop-core`. `apps/mcp` and
the future `apps/cli` are both thin layers over it, so they cannot drift on what's
permitted. If you add a rule, add it to the engine, never to an interface.

---

## 4. The rules the engine enforces

This is the actual value. Each of these is a refusal, and each has tests.

### Gates are computed, never narrated

A gate is a shell command from `stackforge.json`. `exit 0` = pass. Anything else = fail,
with real stderr attached. There is no path by which an agent's claim becomes a pass.

### `markDone` requires evidence

`LoopEngine.markDone()` refuses unless **all** hold:

- ≥1 recorded iteration (work actually happened)
- every **blocking** gate has been run for this milestone
- every blocking gate **passed** on its most recent run
- the milestone's `validateCommand` passed, if one is defined

Non-blocking gates (e.g. lint during cleanup) are recorded but never block.

**There is no `force` flag, and this is intentional.** A caller who could set
`force: true` would set it, and the method would become decoration. Do not add one.

Tests: `engine.test.ts` → `describe("markDone — the refusals")`, 7 cases.

### A gate that was never run is not a pass

Running `loop_gate({only: ["typecheck"]})` and then trying to finish fails with
`blocking gate(s) never run: test`. Partial evidence is not evidence.

### Dependencies must be satisfied before work starts

See §6 — this was the most important fix on the branch.

### Iterations are capped

`maxIterations` per milestone (default 10). Hitting it throws, with a message telling the
agent to surface to the human rather than retry. Hitting the cap is a signal the loop isn't
converging, not a failure to route around.

### State survives the session

Everything is in SQLite in the repo. `resume()` returns goal, plan, progress, last action,
planned next step, the last gate failure, and recorded decisions — enough for a cold agent
to continue without the human re-explaining anything.

### Completion writes memory

`markDone` records a `built` memory. `preflight` searches those. That closes the loop on
"it rebuilds things it already made."

---

## 5. File map

### `packages/loop-core/` — complete, 161 tests green

| File | Purpose | Notes |
|---|---|---|
| `src/types.ts` | Domain types + status enums | `Loop`, `Milestone`, `Iteration`, `GateRun`, `MemoryEntry`, `BlockedReason`. Plain data only — everything must survive a process exit as JSON/SQLite |
| `src/config.ts` | `stackforge.json` schema (zod) | Gates accept shorthand `"tsc --noEmit"` or full object. Normalises to sorted array |
| `src/config-loader.ts` | Finds config by walking up | Same as package managers finding `package.json`. Missing config is **not** an error — only gate execution needs gates |
| `src/util.ts` | `nowIso`, `newId`, `truncateOutput`, `normalizeTags` | `truncateOutput` keeps the **tail** — compilers print the summary last |
| `src/db/database.ts` | Open + migrate | WAL mode, `foreign_keys = ON`, `busy_timeout`. 2 migrations |
| `src/db/rows.ts` | Row↔domain mappers | SQLite has no bool/array; conversion is isolated here so nothing else remembers `passed` is an integer |
| `src/db/state-store.ts` | All persistence + invariants | Largest file. Also holds `resolveDependencies` and cycle detection |
| `src/gates/runner.ts` | Subprocess execution | `runGate`, `runGateSuite`, `formatGateFailure`, `killTree` |
| `src/engine.ts` | `LoopEngine` — public API | Every refusal lives here |
| `src/index.ts` | Barrel export | |

Tests (`packages/loop-core/test/`):

| File | Count | Covers |
|---|---|---|
| `helpers.ts` | — | `makeEngine`, in-memory DB, cross-platform `CMD.pass` / `CMD.fail` / `CMD.slow` |
| `config.test.ts` | 16 | Shorthand expansion, ordering, discovery, malformed JSON |
| `state-store.test.ts` | 47 | One-active-loop, append-only history, re-planning, FTS5 memory, injection-safe search |
| `gates.test.ts` | 20 | **Real subprocesses.** Exit codes, timeouts, fail-fast, truncation |
| `engine.test.ts` | 51 | Every rule, especially the `markDone` refusals |
| `dependencies.test.ts` | 25 | Sequential default, the guard, cycles, parallel work |

`gates.test.ts` deliberately spawns real processes rather than mocking `spawn`. The premise
of a gate is that it reflects reality; a mocked exit code would prove nothing.

### `apps/mcp/` — written, not compiling, no tests

| File | Purpose |
|---|---|
| `src/format.ts` | Text formatters. **This is the real API surface** — MCP returns text to a model, so wording matters. Two rules: lead with the verdict; on failure include raw output |
| `src/tools.ts` | 14 tool definitions + `guard()` error wrapper |
| `src/server.ts` | stdio transport, `resolveProjectRoot`, registration loop |

The 14 tools: `loop_start`, `loop_plan`, `loop_status`, `loop_resume`, `loop_preflight`,
`loop_checkpoint`, `loop_gate`, `loop_validate`, `loop_done`, `loop_skip`, `loop_remember`,
`loop_recall`, `loop_history`, `loop_pause`.

### Does not exist

- `apps/cli/` — planned commands were `init`, `status`, `resume`, `gate`, `history`,
  `memory`, `loops`, `doctor`. None written.
- `README.md` for the new architecture
- Example `stackforge.json` at repo root
- Root `package.json` scripts for cli/mcp
- Any test for `apps/mcp`

---

## 6. Bugs found, and the one the user found

Worth reading — it tells you which parts have been stress-tested and which haven't.

### Bug 1: Windows timeout leak (found by tests)

`gates.test.ts` timeout cases passed but took **11 seconds each**; the suite took 34.66s.

Cause: `child.kill()` signals the shell we spawned, not the process the shell launched.
`ping -n 12` kept running to completion while we'd already reported it killed. A real
resource leak — a timed-out test suite would keep burning CPU in the background.

Fix: `killTree()` in `gates/runner.ts`. POSIX gets `detached: true` plus
`process.kill(-pid)` to signal the process group; Windows gets `taskkill /pid <n> /T /F`.

Suite went 34.66s → **2.71s**.

### Bug 2: timeout message lost on Windows (follow-on)

After the tree-kill fix, one test failed: stderr didn't contain `"timed out"`.

Cause: `taskkill /F` makes the process report an **exit code**, while POSIX signals report
`code === null`. The close handler checked `code !== null` first, so the timeout branch
never ran on Windows.

Fix: check the `timedOut` flag **before** interpreting how the OS reported the death. A
timeout is our decision, not the OS's.

### Bug 3: blocked milestone became invisible (found by tests)

Four engine tests failed simultaneously. `getCurrentMilestone` asked only two questions:
is anything `active`? then, is anything `pending`? `BLOCKED` matched neither.

So: agent works M1 → M1 `active` → gates fail → M1 `blocked` → next call for "what now?"
finds nothing active, falls through to pending, **returns M2**. The engine silently
advanced past broken work. `resume()` reported "Current: M2" immediately after M1's gates
failed.

Fix: `status IN ('active','blocked')` as the in-flight tier, ranked above pending.

### The gap the user found — dependencies

After bug 3, M1 stayed visible as current. But the user pointed out something the tests
did not cover: *visibility isn't prevention.* If M2 builds on M1, M2 must not start while
M1's tests are red, or M2's work may have to be redone.

I wrote a throwaway probe before assuming. It printed:

```
M1 gates passed? false | M1 status: blocked
Started M2 while M1 blocked? YES | M2 status: active
```

Confirmed: nothing objected. (The probe file was deleted; don't look for it.)

The fix is the `dependsOn` feature — migration 2, `resolveDependencies`,
`checkDependencies`, `assertDependenciesMet` in `checkpoint`, `waitingOnDependencies` in
status, and dependency-aware `getCurrentMilestone`. Now:

```
LoopError: Cannot work on "M2" yet: it depends on M1 (JWT login) is blocked.
Finish the prerequisite first — work built on an unfinished dependency may have to be
redone. If "M2" genuinely does not depend on it, re-plan with an explicit dependsOn list,
or skip the prerequisite with a reason.
```

**Design choice: sequential by default.** Omitting `dependsOn` means "depends on the
previous milestone in the plan." Passing `dependsOn: []` explicitly declares independence.
Absent and empty deliberately mean different things — most plans are sequential, so the
zero-config default should be the safe one, but genuine parallelism (a CI milestone that
doesn't need the DB schema) stays expressible.

Cycles are rejected at plan time with a path in the message. The error also detects when
the *sequential default* closed the cycle — declaring a dependency on a milestone listed
later does this, and the offending edge isn't visible in the plan, so the message says so
explicitly. (I hit this myself writing a test.)

---

## 7. Decisions a future session should not silently reverse

- **No `force` on `markDone`.** It would be used, and the method becomes theatre.
- **No LLM anywhere in `loop-core`.** No provider layer, no API key. If verification needs
  a model, it belongs behind a shell command the user configures, not inside the engine.
- **MCP tools never accept a shell command.** Callers may only *name* a gate that already
  exists in `stackforge.json`. See §9.
- **Rules go in the engine, not an interface.** Otherwise CLI and MCP drift.
- **Gate output truncation keeps the tail.** The summary is at the end.
- **`skipped` satisfies a dependency.** Skipping is an explicit reasoned decision that the
  work won't happen; treating it as permanently unmet would deadlock the plan.
- **Iterations and gate runs are append-only.** History is evidence.

### One subtle thing I got wrong and then fixed

`getCurrentMilestone`'s in-flight tier ranks `active` above `blocked`. My first comment
justified this with *"a blocked milestone is the one needing attention"* — which argues for
the **opposite** ordering. I'd borrowed the justification for the
in-flight-over-pending change and misapplied it to the tiebreaker. The comment now reads
"most recent explicit intent wins," which is what the code actually implements: if an agent
deliberately moved to an independent milestone, the pointer shouldn't drag it back on every
subsequent call.

**This tiebreaker is exercised but not directly asserted.** The
`"allows parallel work when dependsOn is empty"` test creates the state (M1 blocked, CI
active) but asserts on the `checkpoint` return value, not on `getCurrentMilestone`. If you
touch that ordering, add the assertion first.

It's low-stakes either way: `markDone` independently refuses a blocked milestone, and loop
auto-completion counts blocked milestones as remaining, so broken work can't ship silently
under either ordering. The only difference is which milestone unkeyed calls hit.

---

## 8. Immediate next steps, in order

### 1. Verify state (do this first)

```bash
cd packages/loop-core && bunx tsc --noEmit && bun test   # expect 161 pass
cd ../../apps/mcp     && bunx tsc --noEmit               # expect: find out
```

My final unverified edit added
`import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js"`
to `tools.ts` and changed `ToolDefinition.inputSchema` to that type.

The error was `server.ts(72,9)`: `Record<string, ZodTypeAny>` not assignable to
`AnySchema | ZodRawShapeCompat | undefined`. Root cause: the SDK's types come from
`zod/v3`, which isn't structurally identical to bare `zod@3.24`'s `ZodTypeAny`. Using the
SDK's own exported type is the right approach; whether that import path resolves under
`moduleResolution: NodeNext` is what needs checking. The SDK's `package.json` has an
`"./*"` wildcard export, so it should. If it doesn't, fall back to a narrowly-scoped cast
at the single `registerTool` call rather than loosening `ToolDefinition`.

### 2. Commit

Nothing is committed. Do this as soon as `loop-core` is confirmed green — don't risk
losing 161 passing tests. `loop-core` can be committed independently of the broken MCP app.

### 3. Write MCP tests

Zero coverage today. Test the handlers directly against a real in-memory engine — don't
mock the engine, the interesting behaviour is the refusals propagating through `guard()`
into `isError` responses.

**Trap:** `LoopEngine` resolves `projectRoot` to an absolute path, and the one-active-loop
invariant is keyed on it. Tests sharing `process.cwd()` will collide even with separate
in-memory databases. Give each test a unique fake `projectRoot`, but keep `config.cwd` an
absolute **real** directory or `spawn` will fail on a nonexistent cwd. (`gateCwd` resolves
`config.cwd` against `projectRoot`; `resolve` ignores the base when the second arg is
already absolute.)

### 4. Connect to a real MCP client

**Never done.** The JSON-RPC handshake, schema conversion, and whether an agent actually
calls these tools unprompted are all unverified. This is the largest unknown on the branch
and the thing most likely to require design changes.

`server.ts` writes diagnostics to **stderr only** — stdout is the JSON-RPC channel and a
stray `console.log` corrupts the stream. Keep it that way.

### 5. Then, in rough priority

- `apps/cli` (`doctor` and `status` first — they make the thing debuggable)
- README + example `stackforge.json`
- Root `package.json` scripts
- Decide the fate of v1 (`packages/agents`, `apps/api`, `apps/web`)

---

## 9. Security boundaries

Stated explicitly because they're easy to erode by accident.

- **No network listener.** stdio only. The process is spawned by the client and inherits
  its trust boundary. An HTTP server would need auth and CORS decisions; this needs neither.
- **No API keys, no outbound requests.** Nothing leaves the machine.
- **Gate commands come only from `stackforge.json`** — developer-authored,
  version-controlled, same trust level as an npm script. **No MCP tool accepts a command
  string.** `loop_gate` takes gate *names* and validates them against the config. If a
  caller could pass a command, a prompt-injected agent would have arbitrary code execution.
  Preserve this.
- **Every SQL statement is parameterized.** Milestone keys and search terms come from an
  LLM — untrusted input by definition.
- **FTS5 queries are escaped**, not interpolated. `toFtsQuery` wraps each token in quotes
  so operator characters are literals. An agent searching `auth OR "` would otherwise crash
  the query; there's a test for exactly that.
- `runGate` uses `shell: true` deliberately, so gate commands can be written the way a
  developer types them (`npm test -- --grep auth`, pipes, `&&`). Safe **only** because of
  the config-only boundary above. If that boundary ever moves, revisit this.

---

## 10. Reference

### Config format (`stackforge.json`, project root)

```json
{
  "version": 1,
  "gates": {
    "typecheck": { "command": "npx tsc --noEmit", "order": 10 },
    "test":      { "command": "npm test", "order": 20 },
    "lint":      { "command": "npx eslint . --quiet", "order": 30, "blocking": false }
  },
  "maxIterations": 10,
  "cwd": ".",
  "maxOutputChars": 8000
}
```

Shorthand also works: `"typecheck": "npx tsc --noEmit"`.

| Field | Default | Meaning |
|---|---|---|
| `command` | — | Shell command. `exit 0` = pass |
| `order` | 100 | Lower runs first. Ties broken alphabetically for determinism |
| `blocking` | `true` | `false` = recorded but never blocks |
| `timeoutMs` | 120000 | Hard kill, max 30min |
| `maxIterations` | 10 | Per-milestone ceiling |
| `cwd` | `"."` | Gate working dir, relative to config |
| `maxOutputChars` | 8000 | Per-stream capture cap |

Gates run in `order`, stopping at the first **blocking** failure. Fail-fast is deliberate:
if the project doesn't compile there's no information in 200 test results, and the agent
needs the compiler error unburied.

### Environment variables

| Var | Effect |
|---|---|
| `STACKFORGE_PROJECT_ROOT` | Project root (MCP server only; CLI doesn't exist yet) |
| `STACKFORGE_DB_PATH` | Override the DB location |

`apps/mcp` also accepts `--project <dir>`, which takes precedence over the env var.

### Schema

```
loops ──┬── milestones ──┬── iterations ── (gate_runs.iteration_id)
        │                └── gate_runs
        └── memories ── memories_fts (FTS5, contentless + triggers)
```

Migration 1: initial schema. Migration 2: `milestones.depends_on` (JSON array of keys),
backfilled sequentially for pre-existing rows so empty-vs-sequential doesn't acquire two
meanings. `PRAGMA user_version` tracks the version; each migration runs in its own
transaction so a failure leaves the DB at the last good version.

Dependencies are stored as **keys, not ids**, so a plan can be authored and re-authored
without knowing generated ids.

### Stack

Bun 1.3.0 (`bun:sqlite`, `bun:test` — no native modules, no extra deps), Turborepo,
TypeScript strict with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`verbatimModuleSyntax`.

`exactOptionalPropertyTypes` is why domain input types spell out `?: string | undefined`.
Values arrive from JSON where absent and explicitly-`undefined` are indistinguishable; the
codebase uses conditional spreads (`...(x !== undefined ? { x } : {})`) throughout rather
than fighting it. Match that style.

---

## 11. Where verification ends

Confirmed by execution: all 161 `loop-core` tests, `loop-core` typecheck, the three bug
fixes (each reproduced failing, then passing), and the dependency-gap probe.

Never executed: `apps/mcp` compiling after the final edit; any `apps/mcp` test; the MCP
server against a real client; anything involving `apps/cli`, which doesn't exist.

The shell stopped returning output before I could re-run verification, which is why the last
edit is unconfirmed. Assume `apps/mcp` is broken until the compiler says otherwise.
