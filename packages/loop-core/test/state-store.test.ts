/// <reference types="bun" />
/**
 * StateStore behaviour.
 *
 * These tests encode the invariants the rest of the system relies on:
 * one active loop per project, append-only history, and a memory store that
 * de-duplicates instead of growing a row per restatement.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { StateError, StateStore, toFtsQuery } from "../src/db/state-store.js";
import { SCHEMA_VERSION, migrate } from "../src/db/database.js";
import { LOOP_STATUS, MEMORY_KIND, MILESTONE_STATUS } from "../src/types.js";
import { makeDb } from "./helpers.js";

const PROJECT = "/tmp/project-a";

let db: Database;
let store: StateStore;

beforeEach(() => {
  db = makeDb();
  store = new StateStore(db);
});

afterEach(() => {
  db.close();
});

function startLoop(goal = "ship auth", maxIterations = 3) {
  return store.createLoop({ goal, projectRoot: PROJECT, maxIterations });
}

describe("migrations", () => {
  it("stamps the schema version and is idempotent", () => {
    expect(migrate(db)).toBe(SCHEMA_VERSION);
    expect(migrate(db)).toBe(SCHEMA_VERSION);
  });

  it("enforces foreign keys so orphan rows are impossible", () => {
    const row = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys;").get();
    expect(row?.foreign_keys).toBe(1);
  });
});

describe("loops", () => {
  it("creates a loop and marks it active", () => {
    const loop = startLoop();

    expect(loop.status).toBe(LOOP_STATUS.ACTIVE);
    expect(store.getActiveLoop(PROJECT)?.id).toBe(loop.id);
  });

  it("refuses a second active loop for the same project", () => {
    startLoop();

    expect(() => startLoop("something else")).toThrow(StateError);
    expect(() => startLoop("something else")).toThrow(/already active/);
  });

  it("allows a new loop once the previous one is done", () => {
    const first = startLoop();
    store.setLoopStatus(first.id, LOOP_STATUS.DONE);

    const second = startLoop("next goal");
    expect(second.id).not.toBe(first.id);
    expect(store.getActiveLoop(PROJECT)?.id).toBe(second.id);
  });

  it("isolates loops by project root", () => {
    startLoop();
    const other = store.createLoop({
      goal: "other project",
      projectRoot: "/tmp/project-b",
      maxIterations: 5,
    });

    expect(store.getActiveLoop("/tmp/project-b")?.id).toBe(other.id);
    expect(store.listLoops(PROJECT)).toHaveLength(1);
  });

  it("stamps completedAt only on terminal statuses", () => {
    const loop = startLoop();

    expect(store.setLoopStatus(loop.id, LOOP_STATUS.PAUSED).completedAt).toBeUndefined();
    expect(store.setLoopStatus(loop.id, LOOP_STATUS.DONE).completedAt).toBeDefined();
  });

  it("throws a readable error for an unknown loop id", () => {
    expect(() => store.requireLoop("loop_nope")).toThrow(/Loop not found/);
  });
});

describe("plans", () => {
  it("stores milestones in the given order", () => {
    const loop = startLoop();
    const milestones = store.setPlan(loop.id, [
      { key: "M1", name: "login" },
      { key: "M2", name: "refresh" },
    ]);

    expect(milestones.map((milestone) => milestone.key)).toEqual(["M1", "M2"]);
    expect(milestones.map((milestone) => milestone.position)).toEqual([0, 1]);
    expect(milestones.every((milestone) => milestone.status === MILESTONE_STATUS.PENDING)).toBe(true);
  });

  it("rejects an empty plan", () => {
    const loop = startLoop();
    expect(() => store.setPlan(loop.id, [])).toThrow(/at least one milestone/);
  });

  it("rejects duplicate milestone keys", () => {
    const loop = startLoop();
    expect(() =>
      store.setPlan(loop.id, [
        { key: "M1", name: "a" },
        { key: "M1", name: "b" },
      ]),
    ).toThrow(/Duplicate milestone keys/);
  });

  it("rejects a blank milestone key", () => {
    const loop = startLoop();
    expect(() => store.setPlan(loop.id, [{ key: "   ", name: "a" }])).toThrow(/non-empty key/);
  });

  it("re-planning updates existing milestones without losing their history", () => {
    const loop = startLoop();
    store.setPlan(loop.id, [{ key: "M1", name: "login" }]);
    const m1 = store.getMilestoneByKey(loop.id, "M1");
    store.recordIteration({ milestoneId: m1?.id ?? "", summary: "wrote handler" });

    const replanned = store.setPlan(loop.id, [
      { key: "M1", name: "login (renamed)", validateCommand: "npm test" },
      { key: "M2", name: "refresh" },
    ]);

    expect(replanned[0]?.name).toBe("login (renamed)");
    expect(replanned[0]?.validateCommand).toBe("npm test");
    // Same row: history survives.
    expect(replanned[0]?.id).toBe(m1?.id);
    expect(store.countIterations(m1?.id ?? "")).toBe(1);
  });

  it("refuses to drop a milestone that already has iterations", () => {
    const loop = startLoop();
    store.setPlan(loop.id, [
      { key: "M1", name: "login" },
      { key: "M2", name: "refresh" },
    ]);
    const m1 = store.getMilestoneByKey(loop.id, "M1");
    store.recordIteration({ milestoneId: m1?.id ?? "", summary: "work" });

    expect(() => store.setPlan(loop.id, [{ key: "M2", name: "refresh" }])).toThrow(
      /Cannot drop milestone\(s\) with recorded iterations: M1/,
    );
  });

  it("removes milestones that have no history", () => {
    const loop = startLoop();
    store.setPlan(loop.id, [
      { key: "M1", name: "login" },
      { key: "M2", name: "refresh" },
    ]);

    const replanned = store.setPlan(loop.id, [{ key: "M1", name: "login" }]);
    expect(replanned.map((milestone) => milestone.key)).toEqual(["M1"]);
  });
});

describe("current milestone selection", () => {
  it("returns the first pending milestone when nothing is active", () => {
    const loop = startLoop();
    store.setPlan(loop.id, [
      { key: "M1", name: "a" },
      { key: "M2", name: "b" },
    ]);

    expect(store.getCurrentMilestone(loop.id)?.key).toBe("M1");
  });

  it("prefers an active milestone over a pending one", () => {
    const loop = startLoop();
    store.setPlan(loop.id, [
      { key: "M1", name: "a" },
      { key: "M2", name: "b" },
    ]);
    const m2 = store.getMilestoneByKey(loop.id, "M2");
    store.setMilestoneStatus(m2?.id ?? "", MILESTONE_STATUS.ACTIVE);

    expect(store.getCurrentMilestone(loop.id)?.key).toBe("M2");
  });

  it("skips done milestones", () => {
    const loop = startLoop();
    store.setPlan(loop.id, [
      { key: "M1", name: "a" },
      { key: "M2", name: "b" },
    ]);
    const m1 = store.getMilestoneByKey(loop.id, "M1");
    store.setMilestoneStatus(m1?.id ?? "", MILESTONE_STATUS.DONE);

    expect(store.getCurrentMilestone(loop.id)?.key).toBe("M2");
  });

  it("returns undefined when every milestone is finished", () => {
    const loop = startLoop();
    store.setPlan(loop.id, [{ key: "M1", name: "a" }]);
    const m1 = store.getMilestoneByKey(loop.id, "M1");
    store.setMilestoneStatus(m1?.id ?? "", MILESTONE_STATUS.DONE);

    expect(store.getCurrentMilestone(loop.id)).toBeUndefined();
  });
});

describe("iterations", () => {
  function seed() {
    const loop = startLoop();
    store.setPlan(loop.id, [{ key: "M1", name: "login" }]);
    const milestone = store.getMilestoneByKey(loop.id, "M1");
    return { loop, milestoneId: milestone?.id ?? "" };
  }

  it("assigns sequential numbers the caller cannot influence", () => {
    const { milestoneId } = seed();

    expect(store.recordIteration({ milestoneId, summary: "one" }).number).toBe(1);
    expect(store.recordIteration({ milestoneId, summary: "two" }).number).toBe(2);
    expect(store.recordIteration({ milestoneId, summary: "three" }).number).toBe(3);
  });

  it("flips a pending milestone to active on first recorded work", () => {
    const { loop, milestoneId } = seed();
    store.recordIteration({ milestoneId, summary: "started" });

    expect(store.getMilestoneByKey(loop.id, "M1")?.status).toBe(MILESTONE_STATUS.ACTIVE);
  });

  it("rejects an empty summary", () => {
    const { milestoneId } = seed();
    expect(() => store.recordIteration({ milestoneId, summary: "   " })).toThrow(/non-empty summary/);
  });

  it("round-trips filesTouched through JSON storage", () => {
    const { milestoneId } = seed();
    const iteration = store.recordIteration({
      milestoneId,
      summary: "edits",
      filesTouched: ["src/a.ts", "src/b.ts"],
    });

    expect(iteration.filesTouched).toEqual(["src/a.ts", "src/b.ts"]);
    expect(store.getLatestIteration(milestoneId)?.filesTouched).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("sums self-reported token usage across the loop", () => {
    const { loop, milestoneId } = seed();
    store.recordIteration({ milestoneId, summary: "a", tokensUsed: 1_200 });
    store.recordIteration({ milestoneId, summary: "b", tokensUsed: 800 });

    expect(store.sumTokensUsed(loop.id)).toBe(2_000);
  });

  it("returns 0 tokens when nothing was reported", () => {
    const { loop, milestoneId } = seed();
    store.recordIteration({ milestoneId, summary: "no tokens" });

    expect(store.sumTokensUsed(loop.id)).toBe(0);
  });

  it("lists iterations in ascending order", () => {
    const { milestoneId } = seed();
    store.recordIteration({ milestoneId, summary: "first" });
    store.recordIteration({ milestoneId, summary: "second" });

    expect(store.listIterations(milestoneId).map((iteration) => iteration.summary)).toEqual([
      "first",
      "second",
    ]);
  });
});

describe("gate runs", () => {
  function seed() {
    const loop = startLoop();
    store.setPlan(loop.id, [{ key: "M1", name: "login" }]);
    const milestone = store.getMilestoneByKey(loop.id, "M1");
    return { loop, milestoneId: milestone?.id ?? "" };
  }

  const base = {
    name: "test",
    command: "npm test",
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 12,
    timedOut: false,
  };

  it("persists booleans through SQLite integer columns", () => {
    const { milestoneId } = seed();
    const run = store.recordGateRun({ ...base, milestoneId, passed: true });

    expect(run.passed).toBe(true);
    expect(run.timedOut).toBe(false);
  });

  it("returns only the newest run per gate name", () => {
    const { milestoneId } = seed();
    store.recordGateRun({ ...base, milestoneId, passed: false, exitCode: 1 });
    store.recordGateRun({ ...base, milestoneId, passed: true, exitCode: 0 });
    store.recordGateRun({ ...base, milestoneId, name: "lint", passed: true });

    const latest = store.getLatestGateRuns(milestoneId);

    expect(latest).toHaveLength(2);
    expect(latest.find((run) => run.name === "test")?.passed).toBe(true);
    expect(latest.find((run) => run.name === "lint")?.passed).toBe(true);
  });

  it("truncates oversized output to protect context budgets", () => {
    const tightStore = new StateStore(db, 100);
    const { milestoneId } = seed();
    const run = tightStore.recordGateRun({
      ...base,
      milestoneId,
      passed: false,
      exitCode: 1,
      stdout: "x".repeat(5_000),
    });

    expect(run.stdout.length).toBeLessThan(200);
    expect(run.stdout).toContain("truncated");
  });

  it("keeps the tail of truncated output where summaries live", () => {
    const tightStore = new StateStore(db, 50);
    const { milestoneId } = seed();
    const run = tightStore.recordGateRun({
      ...base,
      milestoneId,
      passed: false,
      exitCode: 1,
      stderr: `${"noise\n".repeat(500)}3 failing`,
    });

    expect(run.stderr).toContain("3 failing");
  });
});

describe("memory", () => {
  it("stores and recalls by content", () => {
    store.remember({ content: "JWT lives in an httpOnly cookie", kind: MEMORY_KIND.FACT });

    const hits = store.recall("jwt cookie");

    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toContain("httpOnly");
  });

  it("merges a verbatim restatement instead of duplicating it", () => {
    const first = store.remember({ content: "use bcrypt cost 12", kind: MEMORY_KIND.DECISION, tags: ["auth"] });
    const second = store.remember({ content: "use bcrypt cost 12", kind: MEMORY_KIND.DECISION, tags: ["hashing"] });

    expect(second.id).toBe(first.id);
    expect(second.tags).toEqual(["auth", "hashing"]);
    expect(store.recall("bcrypt")).toHaveLength(1);
  });

  it("treats the same content under a different kind as distinct", () => {
    store.remember({ content: "rate limit is 100/min", kind: MEMORY_KIND.FACT });
    store.remember({ content: "rate limit is 100/min", kind: MEMORY_KIND.DECISION });

    expect(store.recall("rate limit")).toHaveLength(2);
  });

  it("normalizes tags to lowercase, sorted, de-duplicated", () => {
    const entry = store.remember({
      content: "tagged",
      kind: MEMORY_KIND.FACT,
      tags: ["  Zeta ", "alpha", "ALPHA", ""],
    });

    expect(entry.tags).toEqual(["alpha", "zeta"]);
  });

  it("filters recall by kind", () => {
    store.remember({ content: "auth uses jwt", kind: MEMORY_KIND.FACT });
    store.remember({ content: "auth module shipped", kind: MEMORY_KIND.BUILT });

    const built = store.recall("auth", { kind: MEMORY_KIND.BUILT });

    expect(built).toHaveLength(1);
    expect(built[0]?.kind).toBe(MEMORY_KIND.BUILT);
  });

  it("surfaces pinned entries ahead of better-scoring ones", () => {
    store.remember({ content: "auth detail one", kind: MEMORY_KIND.FACT });
    store.remember({ content: "auth pinned rule", kind: MEMORY_KIND.FACT, pinned: true });

    expect(store.recall("auth")[0]?.pinned).toBe(true);
  });

  it("scopes loop memories to their loop while keeping global ones visible", () => {
    const loop = startLoop();
    store.remember({ content: "loop scoped note", kind: MEMORY_KIND.FACT, loopId: loop.id });
    store.remember({ content: "global note", kind: MEMORY_KIND.FACT });

    const scoped = store.recall("note", { loopId: loop.id });

    expect(scoped).toHaveLength(2);
  });

  it("falls back to recency when the query has no searchable tokens", () => {
    store.remember({ content: "first", kind: MEMORY_KIND.FACT });
    store.remember({ content: "second", kind: MEMORY_KIND.FACT });

    const hits = store.recall("!!!  ???");

    expect(hits.length).toBeGreaterThan(0);
  });

  it("survives FTS5 operator characters in the query", () => {
    store.remember({ content: "auth and tokens", kind: MEMORY_KIND.FACT });

    // These would be syntax errors if passed to MATCH unescaped.
    for (const query of ['auth OR "', "NEAR(a b)", "tokens*", '"unclosed']) {
      expect(() => store.recall(query)).not.toThrow();
    }
  });

  it("rejects empty content", () => {
    expect(() => store.remember({ content: "   ", kind: MEMORY_KIND.FACT })).toThrow(/non-empty/);
  });

  it("forgets an entry and reports whether it existed", () => {
    const entry = store.remember({ content: "temporary", kind: MEMORY_KIND.FACT });

    expect(store.forget(entry.id)).toBe(true);
    expect(store.forget(entry.id)).toBe(false);
    expect(store.recall("temporary")).toHaveLength(0);
  });

  it("keeps the FTS index in sync after a delete", () => {
    const entry = store.remember({ content: "indexed content", kind: MEMORY_KIND.FACT });
    store.forget(entry.id);
    store.remember({ content: "indexed content", kind: MEMORY_KIND.FACT });

    expect(store.recall("indexed")).toHaveLength(1);
  });

  it("cascades loop deletion to its memories", () => {
    const loop = startLoop();
    store.remember({ content: "scoped", kind: MEMORY_KIND.FACT, loopId: loop.id });

    db.query("DELETE FROM loops WHERE id = ?").run(loop.id);

    expect(store.recall("scoped")).toHaveLength(0);
  });
});

describe("toFtsQuery", () => {
  it("quotes each token and joins with OR", () => {
    expect(toFtsQuery("auth token")).toBe('"auth" OR "token"');
  });

  it("strips punctuation that FTS5 would treat as syntax", () => {
    expect(toFtsQuery("auth-token, refresh!")).toBe('"auth" OR "token" OR "refresh"');
  });

  it("returns undefined when nothing searchable remains", () => {
    expect(toFtsQuery("   ***   ")).toBeUndefined();
    expect(toFtsQuery("")).toBeUndefined();
  });

  it("handles unicode word characters", () => {
    expect(toFtsQuery("café naïve")).toBe('"café" OR "naïve"');
  });
});
