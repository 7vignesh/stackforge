/**
 * LoopEngine — the public API of the loop layer.
 *
 * Everything an MCP tool or CLI command needs is a method here. The engine owns
 * the rules; the interfaces above it are thin translation layers. That split is
 * what lets the same logic serve `stackforge status` in a terminal and
 * `loop_status` inside Claude Code without duplicating a single decision.
 *
 * The engine contains no LLM calls. It cannot plan, write code, or judge
 * quality. It persists what happened, runs commands, and refuses to let a
 * milestone be called done without evidence.
 */

import type { Database } from "bun:sqlite";
import { openDatabase } from "./db/database.js";
import { StateError, StateStore, type MilestoneInput } from "./db/state-store.js";
import { emptyLoopConfig, type LoopConfig } from "./config.js";
import { formatGateFailure, runGate, runGateSuite, type GateOutcome } from "./gates/runner.js";
import {
  EXISTENCE_VERDICT,
  LOOP_STATUS,
  MEMORY_KIND,
  MILESTONE_STATUS,
  type BlockedReason,
  type ExistenceVerdict,
  type GateRun,
  type Iteration,
  type Loop,
  type MemoryEntry,
  type MemoryHit,
  type MemoryKind,
  type Milestone,
} from "./types.js";
import { resolve } from "node:path";

/** Raised when a caller asks for something the loop rules forbid. */
export class LoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopError";
  }
}

export type LoopEngineOptions = {
  projectRoot: string;
  config?: LoopConfig;
  /** Pre-opened database; the engine opens one when omitted. */
  db?: Database;
  /** Use an in-memory database. Tests only. */
  memory?: boolean;
};

export type StartLoopInput = {
  goal: string;
  milestones?: readonly MilestoneInput[] | undefined;
  maxIterations?: number | undefined;
};

export type PreflightInput = {
  milestoneKey?: string;
  /** Nouns/symbols the agent intends to create; searched against memory. */
  terms: readonly string[];
};

export type PreflightResult = {
  milestone: Milestone;
  verdict: ExistenceVerdict;
  /** Memory hits that triggered a PARTIAL or BUILT verdict. */
  evidence: MemoryHit[];
  guidance: string;
};

export type GateResult = {
  milestone: Milestone;
  outcomes: GateOutcome[];
  recorded: GateRun[];
  passed: boolean;
  skipped: string[];
  /** Raw failure output to hand back to the agent. Empty when all passed. */
  feedback: string;
};

export type LoopStatus = {
  loop: Loop;
  milestones: Milestone[];
  current?: Milestone;
  iterationCount: number;
  maxIterations: number;
  iterationsRemaining: number;
  latestIteration?: Iteration;
  latestGates: GateRun[];
  gatesGreen: boolean;
  tokensUsed: number;
  progress: { done: number; total: number };
  /** Pending milestones waiting on prerequisites, with the reason for each. */
  waitingOnDependencies: Array<{ milestone: Milestone; reason: BlockedReason }>;
};

export type ResumeContext = LoopStatus & {
  /** Config gates, so a cold session knows what "done" is measured against. */
  configuredGates: Array<{ name: string; command: string; blocking: boolean }>;
  recentIterations: Iteration[];
  memories: MemoryEntry[];
  /** One-paragraph brief a cold agent can act on immediately. */
  brief: string;
};

export class LoopEngine {
  private readonly db: Database;
  private readonly store: StateStore;
  private readonly config: LoopConfig;
  readonly projectRoot: string;

  constructor(options: LoopEngineOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.config = options.config ?? emptyLoopConfig();
    this.db =
      options.db ??
      openDatabase({
        projectRoot: this.projectRoot,
        ...(options.memory === true ? { memory: true } : {}),
      });
    this.store = new StateStore(this.db, this.config.maxOutputChars);
  }

  /** Directory gate commands run in, resolved from config. */
  get gateCwd(): string {
    return resolve(this.projectRoot, this.config.cwd);
  }

  get gates(): LoopConfig["gates"] {
    return this.config.gates;
  }

  close(): void {
    this.db.close();
  }

  // ── Planning ─────────────────────────────────────────────────────────────

  /**
   * Start a loop for a goal, optionally with its milestone plan.
   *
   * The engine does not slice the goal itself — that is the agent's job, and
   * the agent has the codebase in context. The engine only insists the slices
   * are well-formed.
   */
  start(input: StartLoopInput): { loop: Loop; milestones: Milestone[] } {
    const goal = input.goal.trim();
    if (goal.length === 0) {
      throw new LoopError("A loop needs a non-empty goal.");
    }

    const loop = this.store.createLoop({
      goal,
      projectRoot: this.projectRoot,
      maxIterations: input.maxIterations ?? this.config.maxIterations,
    });

    const milestones =
      input.milestones !== undefined && input.milestones.length > 0
        ? this.store.setPlan(loop.id, input.milestones)
        : [];

    return { loop, milestones };
  }

  /** Replace the milestone plan of the active loop. */
  plan(milestones: readonly MilestoneInput[]): { loop: Loop; milestones: Milestone[] } {
    const loop = this.requireActiveLoop();
    return { loop, milestones: this.store.setPlan(loop.id, milestones) };
  }

  getActiveLoop(): Loop | undefined {
    return this.store.getActiveLoop(this.projectRoot);
  }

  listLoops(): Loop[] {
    return this.store.listLoops(this.projectRoot);
  }

  // ── Existence pre-flight ─────────────────────────────────────────────────

  /**
   * Answer "is this already built?" before any code is written.
   *
   * Searches the memory store for prior `built` entries matching the terms the
   * agent is about to implement. A forgetful agent's honest default is to build
   * again; this is the cheapest possible guard against a duplicate that drifts.
   */
  preflight(input: PreflightInput): PreflightResult {
    const loop = this.requireActiveLoop();
    const milestone = this.resolveMilestone(loop.id, input.milestoneKey);

    const query = [milestone.name, ...input.terms].join(" ");
    const hits = this.store
      .recall(query, { loopId: loop.id, limit: 10 })
      .filter((hit) => hit.kind === MEMORY_KIND.BUILT);

    // Direct term matches are treated as strong evidence; a hit only on the
    // milestone's own name is weak (the plan mentions it, that proves nothing).
    const termHits = hits.filter((hit) =>
      input.terms.some((term) => hit.content.toLowerCase().includes(term.trim().toLowerCase())),
    );

    const verdict: ExistenceVerdict =
      termHits.length >= 2
        ? EXISTENCE_VERDICT.BUILT
        : termHits.length === 1
          ? EXISTENCE_VERDICT.PARTIAL
          : EXISTENCE_VERDICT.UNBUILT;

    this.store.setExistenceVerdict(milestone.id, verdict);

    const guidance =
      verdict === EXISTENCE_VERDICT.BUILT
        ? "Already built. Do not rebuild — read the existing implementation and confirm it covers the milestone. If it does, mark the milestone done."
        : verdict === EXISTENCE_VERDICT.PARTIAL
          ? "Partially built. Narrow the milestone to extending what exists rather than creating it from scratch."
          : "Nothing found. Safe to build.";

    return {
      milestone: this.store.requireMilestone(milestone.id),
      verdict,
      evidence: hits,
      guidance,
    };
  }

  // ── Iterations ───────────────────────────────────────────────────────────

  /**
   * Record one pass of work.
   *
   * Two refusals here:
   *  - Unmet dependencies. Starting M2 while M1's tests are red produces work
   *    built on a broken foundation; if M2 depends on M1, that work may have to
   *    be redone once M1 is actually fixed.
   *  - The iteration ceiling. Hitting the cap is not a failure state, it is a
   *    signal that the loop is not converging and a human should look — the
   *    alternative is an agent burning budget on attempt 47 of the same fix.
   */
  checkpoint(input: {
    milestoneKey?: string;
    summary: string;
    filesTouched?: readonly string[];
    tokensUsed?: number;
    nextAction?: string;
  }): { iteration: Iteration; milestone: Milestone; iterationsRemaining: number } {
    const loop = this.requireActiveLoop();
    const milestone = this.resolveMilestone(loop.id, input.milestoneKey);

    this.assertDependenciesMet(milestone);

    const used = this.store.countIterations(milestone.id);

    if (used >= loop.maxIterations) {
      throw new LoopError(
        `Milestone "${milestone.key}" has hit its iteration cap (${loop.maxIterations}). ` +
          `The loop is not converging — surface this to the human instead of retrying. ` +
          `Raise maxIterations in stackforge.json only if the extra passes are justified.`,
      );
    }

    const iteration = this.store.recordIteration({
      milestoneId: milestone.id,
      summary: input.summary,
      ...(input.filesTouched !== undefined ? { filesTouched: input.filesTouched } : {}),
      ...(input.tokensUsed !== undefined ? { tokensUsed: input.tokensUsed } : {}),
      ...(input.nextAction !== undefined ? { nextAction: input.nextAction } : {}),
    });

    return {
      iteration,
      milestone: this.store.requireMilestone(milestone.id),
      iterationsRemaining: loop.maxIterations - (used + 1),
    };
  }

  /**
   * Refuse work on a milestone whose prerequisites are unfinished.
   *
   * The message names each unmet dependency and its current status, so the agent
   * is told what to go finish rather than merely being told no.
   */
  private assertDependenciesMet(milestone: Milestone): void {
    const reason = this.store.checkDependencies(milestone.id);

    if (reason === undefined) {
      return;
    }

    const detail = reason.detail
      .map((entry) => `${entry.key} (${entry.name}) is ${entry.status}`)
      .join("; ");

    throw new LoopError(
      `Cannot work on "${milestone.key}" yet: it depends on ${detail}. ` +
        `Finish the prerequisite first — work built on an unfinished dependency may have to be ` +
        `redone. If "${milestone.key}" genuinely does not depend on it, re-plan with an explicit ` +
        `dependsOn list, or skip the prerequisite with a reason.`,
    );
  }

  // ── Gates ────────────────────────────────────────────────────────────────

  /**
   * Run configured gates and persist the evidence.
   *
   * `only` restricts the run to named gates — useful mid-iteration when the
   * agent wants a fast typecheck without paying for the whole test suite.
   */
  async runGates(input: { milestoneKey?: string; only?: readonly string[] } = {}): Promise<GateResult> {
    const loop = this.requireActiveLoop();
    const milestone = this.resolveMilestone(loop.id, input.milestoneKey);

    let selected = this.config.gates;

    if (input.only !== undefined && input.only.length > 0) {
      const wanted = new Set(input.only.map((name) => name.trim()));
      const unknown = [...wanted].filter(
        (name) => !this.config.gates.some((gate) => gate.name === name),
      );

      if (unknown.length > 0) {
        const available = this.config.gates.map((gate) => gate.name).join(", ") || "(none)";
        throw new LoopError(
          `Unknown gate(s): ${unknown.join(", ")}. Configured gates: ${available}`,
        );
      }

      selected = this.config.gates.filter((gate) => wanted.has(gate.name));
    }

    if (selected.length === 0) {
      throw new LoopError(
        "No gates configured. Add a `gates` block to stackforge.json — without gates, " +
          "'done' is an opinion.",
      );
    }

    const latestIteration = this.store.getLatestIteration(milestone.id);

    const suite = await runGateSuite(selected, {
      cwd: this.gateCwd,
      maxOutputChars: this.config.maxOutputChars,
    });

    const recorded = suite.outcomes.map((outcome) =>
      this.store.recordGateRun({
        milestoneId: milestone.id,
        ...(latestIteration !== undefined ? { iterationId: latestIteration.id } : {}),
        name: outcome.name,
        command: outcome.command,
        passed: outcome.passed,
        exitCode: outcome.exitCode,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        durationMs: outcome.durationMs,
        timedOut: outcome.timedOut,
      }),
    );

    const failures = suite.outcomes.filter((outcome) => !outcome.passed);
    const feedback = failures.map(formatGateFailure).join("\n\n---\n\n");

    // A blocking failure moves the milestone to `blocked` so status readers see
    // the problem without having to interpret gate rows themselves.
    if (!suite.passed && milestone.status === MILESTONE_STATUS.ACTIVE) {
      this.store.setMilestoneStatus(milestone.id, MILESTONE_STATUS.BLOCKED);
    } else if (suite.passed && milestone.status === MILESTONE_STATUS.BLOCKED) {
      this.store.setMilestoneStatus(milestone.id, MILESTONE_STATUS.ACTIVE);
    }

    return {
      milestone: this.store.requireMilestone(milestone.id),
      outcomes: suite.outcomes,
      recorded,
      passed: suite.passed,
      skipped: suite.skipped,
      feedback,
    };
  }

  /**
   * Run a milestone's own `validateCommand` — the demo command that proves the
   * outcome, distinct from the project-wide gates.
   */
  async runValidate(input: { milestoneKey?: string } = {}): Promise<GateResult> {
    const loop = this.requireActiveLoop();
    const milestone = this.resolveMilestone(loop.id, input.milestoneKey);

    if (milestone.validateCommand === undefined) {
      throw new LoopError(
        `Milestone "${milestone.key}" has no validateCommand. ` +
          `If you cannot write the command that proves it works, the milestone is too vague — split it.`,
      );
    }

    const latestIteration = this.store.getLatestIteration(milestone.id);

    const outcome = await runGate(
      {
        name: `validate:${milestone.key}`,
        command: milestone.validateCommand,
        timeoutMs: 120_000,
        order: 0,
        blocking: true,
      },
      { cwd: this.gateCwd, maxOutputChars: this.config.maxOutputChars },
    );

    const recorded = this.store.recordGateRun({
      milestoneId: milestone.id,
      ...(latestIteration !== undefined ? { iterationId: latestIteration.id } : {}),
      name: outcome.name,
      command: outcome.command,
      passed: outcome.passed,
      exitCode: outcome.exitCode,
      stdout: outcome.stdout,
      stderr: outcome.stderr,
      durationMs: outcome.durationMs,
      timedOut: outcome.timedOut,
    });

    return {
      milestone: this.store.requireMilestone(milestone.id),
      outcomes: [outcome],
      recorded: [recorded],
      passed: outcome.passed,
      skipped: [],
      feedback: outcome.passed ? "" : formatGateFailure(outcome),
    };
  }

  // ── Completion ───────────────────────────────────────────────────────────

  /**
   * Mark a milestone done — only if the evidence supports it.
   *
   * This is the method that makes the system worth installing. "Done" requires:
   *  - at least one recorded iteration (work actually happened)
   *  - every blocking gate green on its most recent run
   *  - the milestone's validateCommand green, when one is defined
   *
   * No override flag. A caller who could set `force: true` would set it, and
   * then this method would be decoration.
   */
  markDone(input: { milestoneKey?: string; summary?: string } = {}): {
    milestone: Milestone;
    loopComplete: boolean;
    nextMilestone?: Milestone;
  } {
    const loop = this.requireActiveLoop();
    const milestone = this.resolveMilestone(loop.id, input.milestoneKey);

    if (milestone.status === MILESTONE_STATUS.DONE) {
      throw new LoopError(`Milestone "${milestone.key}" is already done.`);
    }

    if (this.store.countIterations(milestone.id) === 0) {
      throw new LoopError(
        `Milestone "${milestone.key}" has no recorded iterations. ` +
          `Record the work with a checkpoint before marking it done.`,
      );
    }

    const latest = this.store.getLatestGateRuns(milestone.id);
    const blockingNames = new Set(
      this.config.gates.filter((gate) => gate.blocking).map((gate) => gate.name),
    );

    const missing = [...blockingNames].filter(
      (name) => !latest.some((run) => run.name === name),
    );

    if (missing.length > 0) {
      throw new LoopError(
        `Cannot mark "${milestone.key}" done: blocking gate(s) never run: ${missing.join(", ")}. ` +
          `Run the gates first — a gate that was not executed is not a pass.`,
      );
    }

    const failing = latest.filter((run) => blockingNames.has(run.name) && !run.passed);
    if (failing.length > 0) {
      const detail = failing
        .map((run) => `${run.name} (exit ${run.exitCode})`)
        .join(", ");
      throw new LoopError(
        `Cannot mark "${milestone.key}" done: failing gate(s): ${detail}. ` +
          `Fix the failures and re-run the gates.`,
      );
    }

    if (milestone.validateCommand !== undefined) {
      const validateName = `validate:${milestone.key}`;
      const validateRun = latest.find((run) => run.name === validateName);

      if (validateRun === undefined) {
        throw new LoopError(
          `Cannot mark "${milestone.key}" done: its validateCommand has not been run. ` +
            `Run validate to prove the outcome.`,
        );
      }

      if (!validateRun.passed) {
        throw new LoopError(
          `Cannot mark "${milestone.key}" done: validateCommand failed ` +
            `(exit ${validateRun.exitCode}).`,
        );
      }
    }

    const done = this.store.setMilestoneStatus(milestone.id, MILESTONE_STATUS.DONE);

    // Completion is the moment worth remembering: this is what future
    // pre-flights search to avoid rebuilding the same capability.
    this.store.remember({
      content:
        input.summary !== undefined && input.summary.trim().length > 0
          ? input.summary.trim()
          : `${done.name} — completed and gate-verified.`,
      kind: MEMORY_KIND.BUILT,
      tags: [done.key, ...done.name.toLowerCase().split(/\s+/).filter((word) => word.length > 2)],
      loopId: loop.id,
      milestoneId: done.id,
      source: "loop-engine",
    });

    const remaining = this.store
      .listMilestones(loop.id)
      .filter(
        (candidate) =>
          candidate.status !== MILESTONE_STATUS.DONE &&
          candidate.status !== MILESTONE_STATUS.SKIPPED,
      );

    if (remaining.length === 0) {
      this.store.setLoopStatus(loop.id, LOOP_STATUS.DONE);
      return { milestone: done, loopComplete: true };
    }

    const next = remaining[0];
    return {
      milestone: done,
      loopComplete: false,
      ...(next !== undefined ? { nextMilestone: next } : {}),
    };
  }

  /** Skip a milestone with an explicit reason. Recorded, not silent. */
  skipMilestone(input: { milestoneKey?: string; reason: string }): Milestone {
    const loop = this.requireActiveLoop();
    const milestone = this.resolveMilestone(loop.id, input.milestoneKey);
    const reason = input.reason.trim();

    if (reason.length === 0) {
      throw new LoopError("Skipping a milestone requires a reason.");
    }

    const skipped = this.store.setMilestoneStatus(milestone.id, MILESTONE_STATUS.SKIPPED);

    this.store.remember({
      content: `Skipped ${skipped.key} (${skipped.name}): ${reason}`,
      kind: MEMORY_KIND.DECISION,
      tags: [skipped.key, "skipped"],
      loopId: loop.id,
      milestoneId: skipped.id,
      source: "loop-engine",
    });

    return skipped;
  }

  setLoopStatus(status: Loop["status"]): Loop {
    const loop = this.requireActiveLoop();
    return this.store.setLoopStatus(loop.id, status);
  }

  // ── Status & resume ──────────────────────────────────────────────────────

  status(): LoopStatus {
    const loop = this.requireActiveLoop();
    const milestones = this.store.listMilestones(loop.id);
    const current = this.store.getCurrentMilestone(loop.id);

    const iterationCount = current !== undefined ? this.store.countIterations(current.id) : 0;
    const latestIteration =
      current !== undefined ? this.store.getLatestIteration(current.id) : undefined;
    const latestGates = current !== undefined ? this.store.getLatestGateRuns(current.id) : [];

    const blockingNames = new Set(
      this.config.gates.filter((gate) => gate.blocking).map((gate) => gate.name),
    );

    const gatesGreen =
      latestGates.length > 0 &&
      [...blockingNames].every((name) =>
        latestGates.some((run) => run.name === name && run.passed),
      );

    return {
      loop,
      milestones,
      ...(current !== undefined ? { current } : {}),
      iterationCount,
      maxIterations: loop.maxIterations,
      iterationsRemaining: Math.max(0, loop.maxIterations - iterationCount),
      ...(latestIteration !== undefined ? { latestIteration } : {}),
      latestGates,
      gatesGreen,
      tokensUsed: this.store.sumTokensUsed(loop.id),
      progress: {
        done: milestones.filter((milestone) => milestone.status === MILESTONE_STATUS.DONE).length,
        total: milestones.length,
      },
      waitingOnDependencies: this.store.listBlockedByDependencies(loop.id),
    };
  }

  /**
   * Everything a cold session needs, in one call.
   *
   * This is the answer to "the agent forgets": a fresh context calls resume and
   * knows the goal, what shipped, what is in flight, what failed last, and what
   * was decided — without the human re-explaining any of it.
   */
  resume(): ResumeContext {
    const status = this.status();
    const recentIterations =
      status.current !== undefined
        ? this.store.listIterations(status.current.id).slice(-5)
        : [];

    const memories = this.store.recentMemories({ loopId: status.loop.id }, 25);

    return {
      ...status,
      configuredGates: this.config.gates.map((gate) => ({
        name: gate.name,
        command: gate.command,
        blocking: gate.blocking,
      })),
      recentIterations,
      memories,
      brief: buildBrief(status, recentIterations),
    };
  }

  /** Full history for one milestone: iterations plus gate runs. */
  history(milestoneKey?: string): {
    milestone: Milestone;
    iterations: Iteration[];
    gateRuns: GateRun[];
  } {
    const loop = this.requireActiveLoop();
    const milestone = this.resolveMilestone(loop.id, milestoneKey);

    return {
      milestone,
      iterations: this.store.listIterations(milestone.id),
      gateRuns: this.store.listGateRuns(milestone.id),
    };
  }

  // ── Memory ───────────────────────────────────────────────────────────────

  remember(input: {
    content: string;
    kind?: MemoryKind;
    tags?: readonly string[];
    milestoneKey?: string;
    pinned?: boolean;
    source?: string;
  }): MemoryEntry {
    const loop = this.getActiveLoop();
    const milestone =
      loop !== undefined && input.milestoneKey !== undefined
        ? this.store.getMilestoneByKey(loop.id, input.milestoneKey)
        : undefined;

    return this.store.remember({
      content: input.content,
      kind: input.kind ?? MEMORY_KIND.FACT,
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(loop !== undefined ? { loopId: loop.id } : {}),
      ...(milestone !== undefined ? { milestoneId: milestone.id } : {}),
      ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
    });
  }

  recall(query: string, options: { kind?: MemoryKind; limit?: number } = {}): MemoryHit[] {
    const loop = this.getActiveLoop();

    return this.store.recall(query, {
      ...(loop !== undefined ? { loopId: loop.id } : {}),
      ...(options.kind !== undefined ? { kind: options.kind } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
  }

  forget(memoryId: string): boolean {
    return this.store.forget(memoryId);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private requireActiveLoop(): Loop {
    const loop = this.getActiveLoop();

    if (loop === undefined) {
      throw new LoopError(
        "No active loop for this project. Start one with a goal and a milestone plan.",
      );
    }

    return loop;
  }

  /**
   * Resolve a milestone by key, or fall back to the current one.
   *
   * Explicit keys win so an agent can act on a specific milestone; the fallback
   * keeps the common case ("the thing I'm working on") free of ceremony.
   */
  private resolveMilestone(loopId: string, key?: string): Milestone {
    if (key !== undefined && key.trim().length > 0) {
      const milestone = this.store.getMilestoneByKey(loopId, key);

      if (milestone === undefined) {
        const available = this.store
          .listMilestones(loopId)
          .map((candidate) => candidate.key)
          .join(", ");
        throw new LoopError(`Unknown milestone "${key}". Available: ${available || "(none)"}`);
      }

      return milestone;
    }

    const current = this.store.getCurrentMilestone(loopId);

    if (current === undefined) {
      throw new LoopError(
        "No milestone is pending or active. Every milestone is done or skipped — " +
          "either the loop is complete or it needs a new plan.",
      );
    }

    return current;
  }
}

/** Compose the human/agent-readable brief used by resume(). */
function buildBrief(status: LoopStatus, recentIterations: readonly Iteration[]): string {
  const lines: string[] = [
    `Goal: ${status.loop.goal}`,
    `Progress: ${status.progress.done}/${status.progress.total} milestones done.`,
  ];

  if (status.current === undefined) {
    if (status.waitingOnDependencies.length > 0) {
      const waiting = status.waitingOnDependencies
        .map((entry) => `${entry.milestone.key} waits on ${entry.reason.unmet.join(", ")}`)
        .join("; ");
      lines.push(
        `No milestone can start: ${waiting}. Resolve a prerequisite, or skip it with a reason.`,
      );
      return lines.join("\n");
    }

    lines.push("No milestone is active. The plan is exhausted.");
    return lines.join("\n");
  }

  lines.push(
    `Current: ${status.current.key} — ${status.current.name} (${status.current.status}), ` +
      `iteration ${status.iterationCount}/${status.maxIterations}.`,
  );

  if (status.current.dependsOn.length > 0) {
    lines.push(`Depends on: ${status.current.dependsOn.join(", ")} (satisfied).`);
  }

  const last = recentIterations.at(-1);
  if (last !== undefined) {
    lines.push(`Last action: ${last.summary}`);
    if (last.nextAction !== undefined) {
      lines.push(`Planned next: ${last.nextAction}`);
    }
  }

  if (status.latestGates.length === 0) {
    lines.push("Gates: never run for this milestone.");
  } else {
    const summary = status.latestGates
      .map((run) => `${run.name}=${run.passed ? "pass" : `fail(${run.exitCode})`}`)
      .join(" ");
    lines.push(`Gates: ${summary}`);

    const failing = status.latestGates.filter((run) => !run.passed);
    if (failing.length > 0) {
      const first = failing[0];
      if (first !== undefined) {
        const detail = (first.stderr.trim() || first.stdout.trim()).split("\n").slice(0, 5).join("\n");
        lines.push(`Blocking failure in "${first.name}":\n${detail}`);
      }
    }
  }

  if (status.waitingOnDependencies.length > 0) {
    const waiting = status.waitingOnDependencies
      .map((entry) => `${entry.milestone.key} (waits on ${entry.reason.unmet.join(", ")})`)
      .join(", ");
    lines.push(`Not yet startable: ${waiting}`);
  }

  return lines.join("\n");
}

export { StateError };
