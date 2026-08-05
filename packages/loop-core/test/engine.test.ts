/// <reference types="bun" />
/**
 * LoopEngine behaviour — the rules layer.
 *
 * The tests that matter most here are the refusals: `markDone` rejecting a
 * milestone without evidence is the entire value proposition. If that can be
 * bypassed, the rest is decoration.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { LoopEngine, LoopError } from "../src/engine.js";
import { EXISTENCE_VERDICT, LOOP_STATUS, MEMORY_KIND, MILESTONE_STATUS } from "../src/types.js";
import { CMD, makeEngine } from "./helpers.js";

const PROJECT = process.cwd();

let engine: LoopEngine;
let db: Database;

/** Engine whose gates all pass. */
function greenEngine() {
  return makeEngine(
    {
      version: 1,
      gates: {
        typecheck: { command: CMD.pass, order: 10 },
        test: { command: CMD.pass, order: 20 },
      },
      maxIterations: 3,
    },
    PROJECT,
  );
}

/** Engine whose `test` gate fails. */
function redEngine() {
  return makeEngine(
    {
      version: 1,
      gates: {
        typecheck: { command: CMD.pass, order: 10 },
        test: { command: CMD.fail, order: 20 },
      },
      maxIterations: 3,
    },
    PROJECT,
  );
}

const PLAN = [
  { key: "M1", name: "JWT login" },
  { key: "M2", name: "Refresh rotation" },
] as const;

afterEach(() => {
  db?.close();
});

describe("start and plan", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
  });

  it("starts a loop with a plan", () => {
    const { loop, milestones } = engine.start({ goal: "ship auth", milestones: PLAN });

    expect(loop.goal).toBe("ship auth");
    expect(loop.status).toBe(LOOP_STATUS.ACTIVE);
    expect(milestones.map((milestone) => milestone.key)).toEqual(["M1", "M2"]);
  });

  it("starts a loop without a plan and accepts one later", () => {
    engine.start({ goal: "explore" });
    expect(engine.status().milestones).toEqual([]);

    const { milestones } = engine.plan(PLAN);
    expect(milestones).toHaveLength(2);
  });

  it("rejects a blank goal", () => {
    expect(() => engine.start({ goal: "   " })).toThrow(/non-empty goal/);
  });

  it("inherits maxIterations from config but lets the caller override it", () => {
    const { loop } = engine.start({ goal: "a", milestones: PLAN });
    expect(loop.maxIterations).toBe(3);

    engine.setLoopStatus(LOOP_STATUS.DONE);
    const second = engine.start({ goal: "b", milestones: PLAN, maxIterations: 7 });
    expect(second.loop.maxIterations).toBe(7);
  });

  it("errors on any loop operation when no loop is active", () => {
    expect(() => engine.status()).toThrow(/No active loop/);
    expect(() => engine.plan(PLAN)).toThrow(/No active loop/);
    expect(() => engine.checkpoint({ summary: "x" })).toThrow(/No active loop/);
  });
});

describe("checkpoint", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "ship auth", milestones: PLAN });
  });

  it("records an iteration against the current milestone", () => {
    const result = engine.checkpoint({ summary: "wrote login handler" });

    expect(result.iteration.number).toBe(1);
    expect(result.milestone.key).toBe("M1");
    expect(result.milestone.status).toBe(MILESTONE_STATUS.ACTIVE);
  });

  it("reports how many iterations remain", () => {
    expect(engine.checkpoint({ summary: "one" }).iterationsRemaining).toBe(2);
    expect(engine.checkpoint({ summary: "two" }).iterationsRemaining).toBe(1);
    expect(engine.checkpoint({ summary: "three" }).iterationsRemaining).toBe(0);
  });

  it("refuses further work past the iteration cap instead of looping forever", () => {
    engine.checkpoint({ summary: "one" });
    engine.checkpoint({ summary: "two" });
    engine.checkpoint({ summary: "three" });

    expect(() => engine.checkpoint({ summary: "four" })).toThrow(LoopError);
    expect(() => engine.checkpoint({ summary: "four" })).toThrow(/not converging/);
  });

  it("targets an explicit milestone when its dependencies are satisfied", () => {
    // M2 depends on M1 by default, so M1 must finish before M2 can be targeted.
    engine.skipMilestone({ milestoneKey: "M1", reason: "handled elsewhere" });

    const result = engine.checkpoint({ milestoneKey: "M2", summary: "started refresh" });

    expect(result.milestone.key).toBe("M2");
  });

  it("refuses an explicit jump to a milestone whose prerequisite is unfinished", async () => {
    ({ engine, db } = redEngine());
    engine.start({ goal: "ship auth", milestones: PLAN });
    engine.checkpoint({ summary: "wrote login" });
    await engine.runGates();

    // M1 is blocked with failing gates. M2 depends on it and must not start.
    expect(() => engine.checkpoint({ milestoneKey: "M2", summary: "jump ahead" })).toThrow(
      /depends on M1/,
    );
  });

  it("rejects an unknown milestone key and lists the valid ones", () => {
    expect(() => engine.checkpoint({ milestoneKey: "M9", summary: "x" })).toThrow(/Unknown milestone/);
    expect(() => engine.checkpoint({ milestoneKey: "M9", summary: "x" })).toThrow(/M1, M2/);
  });

  it("stores files touched and the planned next action", () => {
    const { iteration } = engine.checkpoint({
      summary: "handler + tests",
      filesTouched: ["src/auth/login.ts"],
      nextAction: "add rate limiting",
      tokensUsed: 1_400,
    });

    expect(iteration.filesTouched).toEqual(["src/auth/login.ts"]);
    expect(iteration.nextAction).toBe("add rate limiting");
    expect(engine.status().tokensUsed).toBe(1_400);
  });
});

describe("gates", () => {
  it("passes and records evidence when commands succeed", async () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });

    const result = await engine.runGates();

    expect(result.passed).toBe(true);
    expect(result.outcomes).toHaveLength(2);
    expect(result.recorded).toHaveLength(2);
    expect(result.feedback).toBe("");
  });

  it("fails, blocks the milestone, and returns the raw error output", async () => {
    ({ engine, db } = redEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });

    const result = await engine.runGates();

    expect(result.passed).toBe(false);
    expect(result.milestone.status).toBe(MILESTONE_STATUS.BLOCKED);
    expect(result.feedback).toContain("boom");
    expect(result.feedback).toContain('Gate "test" FAILED');
  });

  it("unblocks a milestone once the gates go green", async () => {
    ({ engine, db } = redEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });
    await engine.runGates();
    expect(engine.status().current?.status).toBe(MILESTONE_STATUS.BLOCKED);

    // A second engine over the same database with passing gates: this is the
    // agent fixing the code and re-running, without losing any history.
    const fixed = new LoopEngine({
      projectRoot: PROJECT,
      config: {
        version: 1,
        gates: [
          { name: "typecheck", command: CMD.pass, timeoutMs: 30_000, order: 10, blocking: true },
          { name: "test", command: CMD.pass, timeoutMs: 30_000, order: 20, blocking: true },
        ],
        maxIterations: 3,
        cwd: ".",
        maxOutputChars: 8_000,
      },
      db,
    });

    const result = await fixed.runGates();

    expect(result.passed).toBe(true);
    expect(result.milestone.status).toBe(MILESTONE_STATUS.ACTIVE);
    expect(result.milestone.key).toBe("M1");
  });

  it("runs only the requested gates", async () => {
    ({ engine, db } = redEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });

    const result = await engine.runGates({ only: ["typecheck"] });

    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.name).toBe("typecheck");
    expect(result.passed).toBe(true);
  });

  it("rejects an unknown gate name and lists what is configured", async () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });

    await expect(engine.runGates({ only: ["nope"] })).rejects.toThrow(/Unknown gate/);
    await expect(engine.runGates({ only: ["nope"] })).rejects.toThrow(/typecheck, test/);
  });

  it("explains itself when no gates are configured at all", async () => {
    ({ engine, db } = makeEngine({ version: 1, gates: {} }, PROJECT));
    engine.start({ goal: "g", milestones: PLAN });

    await expect(engine.runGates()).rejects.toThrow(/No gates configured/);
  });

  it("skips later gates after a blocking failure", async () => {
    ({ engine, db } = makeEngine(
      {
        version: 1,
        gates: {
          typecheck: { command: CMD.fail, order: 10 },
          test: { command: CMD.pass, order: 20 },
        },
      },
      PROJECT,
    ));
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });

    const result = await engine.runGates();

    expect(result.skipped).toEqual(["test"]);
  });
});

describe("validate command", () => {
  it("runs a milestone's own proof command", async () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { typecheck: { command: CMD.pass } } },
      PROJECT,
    ));
    engine.start({
      goal: "g",
      milestones: [{ key: "M1", name: "login", validateCommand: CMD.pass }],
    });
    engine.checkpoint({ summary: "work" });

    const result = await engine.runValidate();

    expect(result.passed).toBe(true);
    expect(result.outcomes[0]?.name).toBe("validate:M1");
  });

  it("insists a milestone without a validate command is too vague", async () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });

    await expect(engine.runValidate()).rejects.toThrow(/too vague/);
  });
});

describe("markDone — the refusals", () => {
  it("refuses without any recorded iteration", async () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });
    await engine.runGates();

    expect(() => engine.markDone()).toThrow(/no recorded iterations/);
  });

  it("refuses when gates were never run", () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });

    expect(() => engine.markDone()).toThrow(/never run/);
    expect(() => engine.markDone()).toThrow(/not a pass/);
  });

  it("refuses while a blocking gate is failing", async () => {
    ({ engine, db } = redEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });
    await engine.runGates();

    expect(() => engine.markDone()).toThrow(/failing gate/);
  });

  it("refuses when only some blocking gates have run", async () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });
    await engine.runGates({ only: ["typecheck"] });

    expect(() => engine.markDone()).toThrow(/never run: test/);
  });

  it("refuses when the validate command has not been run", async () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { typecheck: { command: CMD.pass } } },
      PROJECT,
    ));
    engine.start({
      goal: "g",
      milestones: [{ key: "M1", name: "login", validateCommand: CMD.pass }],
    });
    engine.checkpoint({ summary: "work" });
    await engine.runGates();

    expect(() => engine.markDone()).toThrow(/validateCommand has not been run/);
  });

  it("refuses when the validate command failed", async () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { typecheck: { command: CMD.pass } } },
      PROJECT,
    ));
    engine.start({
      goal: "g",
      milestones: [{ key: "M1", name: "login", validateCommand: CMD.fail }],
    });
    engine.checkpoint({ summary: "work" });
    await engine.runGates();
    await engine.runValidate();

    expect(() => engine.markDone()).toThrow(/validateCommand failed/);
  });

  it("ignores a failing non-blocking gate", async () => {
    ({ engine, db } = makeEngine(
      {
        version: 1,
        gates: {
          typecheck: { command: CMD.pass, order: 10 },
          lint: { command: CMD.fail, order: 20, blocking: false },
        },
      },
      PROJECT,
    ));
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "work" });
    await engine.runGates();

    const result = engine.markDone();
    expect(result.milestone.status).toBe(MILESTONE_STATUS.DONE);
  });
});

describe("markDone — the happy path", () => {
  beforeEach(async () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "ship auth", milestones: PLAN });
    engine.checkpoint({ summary: "wrote login" });
    await engine.runGates();
  });

  it("marks the milestone done and points at the next one", () => {
    const result = engine.markDone();

    expect(result.milestone.status).toBe(MILESTONE_STATUS.DONE);
    expect(result.milestone.completedAt).toBeDefined();
    expect(result.loopComplete).toBe(false);
    expect(result.nextMilestone?.key).toBe("M2");
  });

  it("writes a BUILT memory so future pre-flights find the work", () => {
    engine.markDone({ summary: "JWT login endpoint live at POST /login" });

    const hits = engine.recall("login", { kind: MEMORY_KIND.BUILT });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.content).toContain("POST /login");
  });

  it("refuses to mark the same milestone done twice", () => {
    engine.markDone();

    expect(() => engine.markDone({ milestoneKey: "M1" })).toThrow(/already done/);
  });

  it("completes the loop when the last milestone finishes", async () => {
    engine.markDone();
    engine.checkpoint({ summary: "wrote refresh" });
    await engine.runGates();

    const result = engine.markDone();

    expect(result.loopComplete).toBe(true);
    expect(result.nextMilestone).toBeUndefined();
    expect(engine.getActiveLoop()).toBeUndefined();
  });
});

describe("skipMilestone", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });
  });

  it("skips with a recorded reason", () => {
    const milestone = engine.skipMilestone({ reason: "handled by the payments team" });

    expect(milestone.status).toBe(MILESTONE_STATUS.SKIPPED);
    expect(engine.recall("payments team").length).toBeGreaterThan(0);
  });

  it("requires a reason", () => {
    expect(() => engine.skipMilestone({ reason: "  " })).toThrow(/requires a reason/);
  });

  it("advances the current milestone past the skipped one", () => {
    engine.skipMilestone({ reason: "not needed" });

    expect(engine.status().current?.key).toBe("M2");
  });
});

describe("preflight", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: PLAN });
  });

  it("returns UNBUILT for a clean project", () => {
    const result = engine.preflight({ terms: ["parseInvoice"] });

    expect(result.verdict).toBe(EXISTENCE_VERDICT.UNBUILT);
    expect(result.guidance).toContain("Safe to build");
  });

  it("returns PARTIAL on a single matching BUILT memory", () => {
    engine.remember({ content: "parseInvoice helper exists in src/lib", kind: MEMORY_KIND.BUILT });

    const result = engine.preflight({ terms: ["parseInvoice"] });

    expect(result.verdict).toBe(EXISTENCE_VERDICT.PARTIAL);
    expect(result.guidance).toContain("extending what exists");
  });

  it("returns BUILT on multiple matching BUILT memories", () => {
    engine.remember({ content: "parseInvoice lives in src/lib/invoice.ts", kind: MEMORY_KIND.BUILT });
    engine.remember({ content: "parseInvoice covered by invoice.test.ts", kind: MEMORY_KIND.BUILT });

    const result = engine.preflight({ terms: ["parseInvoice"] });

    expect(result.verdict).toBe(EXISTENCE_VERDICT.BUILT);
    expect(result.guidance).toContain("Do not rebuild");
  });

  it("ignores non-BUILT memories when deciding", () => {
    engine.remember({ content: "we should build parseInvoice", kind: MEMORY_KIND.DECISION });
    engine.remember({ content: "parseInvoice is tricky", kind: MEMORY_KIND.GOTCHA });

    expect(engine.preflight({ terms: ["parseInvoice"] }).verdict).toBe(EXISTENCE_VERDICT.UNBUILT);
  });

  it("persists the verdict on the milestone", () => {
    engine.preflight({ terms: ["anything"] });

    expect(engine.status().current?.existenceVerdict).toBe(EXISTENCE_VERDICT.UNBUILT);
  });
});

describe("status", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "ship auth", milestones: PLAN });
  });

  it("reports progress and remaining iterations", () => {
    engine.checkpoint({ summary: "one" });

    const status = engine.status();

    expect(status.progress).toEqual({ done: 0, total: 2 });
    expect(status.iterationCount).toBe(1);
    expect(status.iterationsRemaining).toBe(2);
    expect(status.current?.key).toBe("M1");
  });

  it("reports gatesGreen false before gates have run", () => {
    expect(engine.status().gatesGreen).toBe(false);
  });

  it("reports gatesGreen true once every blocking gate passes", async () => {
    engine.checkpoint({ summary: "work" });
    await engine.runGates();

    expect(engine.status().gatesGreen).toBe(true);
  });

  it("counts done milestones as progress", async () => {
    engine.checkpoint({ summary: "work" });
    await engine.runGates();
    engine.markDone();

    expect(engine.status().progress).toEqual({ done: 1, total: 2 });
  });
});

describe("resume", () => {
  it("hands a cold session the goal, state, and last failure", async () => {
    ({ engine, db } = redEngine());
    engine.start({ goal: "ship auth", milestones: PLAN });
    engine.checkpoint({ summary: "wrote login handler", nextAction: "add rate limiting" });
    await engine.runGates();

    const context = engine.resume();

    expect(context.brief).toContain("ship auth");
    expect(context.brief).toContain("M1");
    expect(context.brief).toContain("wrote login handler");
    expect(context.brief).toContain("add rate limiting");
    expect(context.brief).toContain("boom");
    expect(context.configuredGates.map((gate) => gate.name)).toEqual(["typecheck", "test"]);
    expect(context.recentIterations).toHaveLength(1);
  });

  it("keeps the recent-iteration window bounded", () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { t: { command: CMD.pass } }, maxIterations: 20 },
      PROJECT,
    ));
    engine.start({ goal: "g", milestones: PLAN });

    for (let index = 1; index <= 8; index += 1) {
      engine.checkpoint({ summary: `iteration ${index}` });
    }

    const context = engine.resume();

    expect(context.recentIterations).toHaveLength(5);
    expect(context.recentIterations[4]?.summary).toBe("iteration 8");
  });

  it("says so plainly when the plan is exhausted", async () => {
    ({ engine, db } = greenEngine());
    engine.start({ goal: "g", milestones: [{ key: "M1", name: "only" }] });
    engine.checkpoint({ summary: "work" });
    await engine.runGates();
    engine.markDone();

    // The loop auto-completed when its last milestone finished, so a fresh loop
    // is needed to inspect resume against a new plan.
    engine.start({ goal: "next goal", milestones: [{ key: "N1", name: "next thing" }] });
    const context = engine.resume();

    expect(context.brief).toContain("next goal");
    expect(context.brief).toContain("N1");
  });
});

describe("history", () => {
  it("returns iterations and gate runs for a milestone", async () => {
    ({ engine, db } = redEngine());
    engine.start({ goal: "g", milestones: PLAN });
    engine.checkpoint({ summary: "first attempt" });
    await engine.runGates();
    engine.checkpoint({ summary: "second attempt" });
    await engine.runGates();

    const history = engine.history();

    expect(history.milestone.key).toBe("M1");
    expect(history.iterations).toHaveLength(2);
    expect(history.gateRuns.length).toBeGreaterThanOrEqual(2);
  });
});

describe("memory via engine", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
  });

  it("scopes remembered entries to the active loop", () => {
    engine.start({ goal: "g", milestones: PLAN });
    engine.remember({ content: "uses bcrypt cost 12", kind: MEMORY_KIND.DECISION });

    expect(engine.recall("bcrypt")).toHaveLength(1);
  });

  it("works before any loop exists", () => {
    engine.remember({ content: "project uses bun", kind: MEMORY_KIND.FACT });

    expect(engine.recall("bun")).toHaveLength(1);
  });

  it("defaults to the FACT kind", () => {
    const entry = engine.remember({ content: "some detail" });

    expect(entry.kind).toBe(MEMORY_KIND.FACT);
  });

  it("forgets an entry by id", () => {
    const entry = engine.remember({ content: "temporary note" });

    expect(engine.forget(entry.id)).toBe(true);
    expect(engine.recall("temporary")).toHaveLength(0);
  });
});
