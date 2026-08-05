/// <reference types="bun" />
/**
 * Milestone dependency rules.
 *
 * The behaviour under test: a milestone whose prerequisite is unfinished cannot
 * be worked on. Without this, an agent whose tests fail on M1 will happily start
 * M2 — and if M2 builds on M1, that work may have to be thrown away once M1 is
 * actually fixed.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { LoopEngine, LoopError } from "../src/engine.js";
import { StateError, resolveDependencies } from "../src/db/state-store.js";
import { MILESTONE_STATUS } from "../src/types.js";
import { CMD, makeEngine } from "./helpers.js";

const PROJECT = process.cwd();

let engine: LoopEngine;
let db: Database;

function greenEngine() {
  return makeEngine(
    { version: 1, gates: { test: { command: CMD.pass } }, maxIterations: 5 },
    PROJECT,
  );
}

function redEngine() {
  return makeEngine(
    { version: 1, gates: { test: { command: CMD.fail } }, maxIterations: 5 },
    PROJECT,
  );
}

afterEach(() => {
  db?.close();
});

describe("sequential by default", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
  });

  it("makes each milestone depend on the one before it", () => {
    const { milestones } = engine.start({
      goal: "auth",
      milestones: [
        { key: "M1", name: "login" },
        { key: "M2", name: "refresh" },
        { key: "M3", name: "rbac" },
      ],
    });

    expect(milestones[0]?.dependsOn).toEqual([]);
    expect(milestones[1]?.dependsOn).toEqual(["M1"]);
    expect(milestones[2]?.dependsOn).toEqual(["M2"]);
  });

  it("leaves the first milestone free to start", () => {
    engine.start({
      goal: "auth",
      milestones: [
        { key: "M1", name: "login" },
        { key: "M2", name: "refresh" },
      ],
    });

    expect(engine.status().current?.key).toBe("M1");
  });

  it("does not offer a milestone whose prerequisite is unfinished", () => {
    engine.start({
      goal: "auth",
      milestones: [
        { key: "M1", name: "login" },
        { key: "M2", name: "refresh" },
      ],
    });

    const waiting = engine.status().waitingOnDependencies;

    expect(waiting).toHaveLength(1);
    expect(waiting[0]?.milestone.key).toBe("M2");
    expect(waiting[0]?.reason.unmet).toEqual(["M1"]);
  });
});

describe("the guard that closes the gap", () => {
  beforeEach(async () => {
    ({ engine, db } = redEngine());
    engine.start({
      goal: "auth",
      milestones: [
        { key: "M1", name: "JWT login" },
        { key: "M2", name: "Refresh rotation" },
      ],
    });
    engine.checkpoint({ summary: "wrote login" });
    await engine.runGates();
  });

  it("leaves M1 blocked when its gates fail", () => {
    expect(engine.status().current?.key).toBe("M1");
    expect(engine.status().current?.status).toBe(MILESTONE_STATUS.BLOCKED);
  });

  it("refuses to start M2 while M1 is broken", () => {
    expect(() => engine.checkpoint({ milestoneKey: "M2", summary: "start refresh" })).toThrow(
      LoopError,
    );
  });

  it("names the prerequisite and its status in the refusal", () => {
    let message = "";
    try {
      engine.checkpoint({ milestoneKey: "M2", summary: "start refresh" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("M2");
    expect(message).toContain("M1");
    expect(message).toContain("JWT login");
    expect(message).toContain("blocked");
  });

  it("allows M2 once M1's gates pass and it is marked done", async () => {
    // The agent fixes the code: same database, now-passing gates.
    const fixed = new LoopEngine({
      projectRoot: PROJECT,
      config: {
        version: 1,
        gates: [
          { name: "test", command: CMD.pass, timeoutMs: 30_000, order: 10, blocking: true },
        ],
        maxIterations: 5,
        cwd: ".",
        maxOutputChars: 8_000,
      },
      db,
    });

    await fixed.runGates();
    fixed.markDone({ summary: "login live at POST /login" });

    const result = fixed.checkpoint({ summary: "started refresh" });

    expect(result.milestone.key).toBe("M2");
  });

  it("treats a skipped prerequisite as satisfied", () => {
    engine.skipMilestone({ milestoneKey: "M1", reason: "shipped by another team" });

    const result = engine.checkpoint({ summary: "started refresh" });

    expect(result.milestone.key).toBe("M2");
  });
});

describe("explicit independence", () => {
  beforeEach(() => {
    ({ engine, db } = redEngine());
  });

  it("allows parallel work when dependsOn is empty", async () => {
    engine.start({
      goal: "app",
      milestones: [
        { key: "M1", name: "database schema" },
        { key: "CI", name: "pipeline setup", dependsOn: [] },
      ],
    });

    engine.checkpoint({ summary: "schema draft" });
    await engine.runGates();
    // M1 is blocked, but CI declared itself independent.
    const result = engine.checkpoint({ milestoneKey: "CI", summary: "added workflow file" });

    expect(result.milestone.key).toBe("CI");
  });

  it("distinguishes an omitted dependsOn from an empty one", () => {
    const { milestones } = engine.start({
      goal: "app",
      milestones: [
        { key: "M1", name: "first" },
        { key: "M2", name: "implicit" },
        { key: "M3", name: "explicit", dependsOn: [] },
      ],
    });

    expect(milestones[1]?.dependsOn).toEqual(["M1"]);
    expect(milestones[2]?.dependsOn).toEqual([]);
  });

  it("supports a milestone depending on several others", () => {
    const { milestones } = engine.start({
      goal: "app",
      milestones: [
        { key: "API", name: "api", dependsOn: [] },
        { key: "UI", name: "ui", dependsOn: [] },
        { key: "E2E", name: "end to end", dependsOn: ["API", "UI"] },
      ],
    });

    expect(milestones[2]?.dependsOn).toEqual(["API", "UI"]);
  });

  it("holds a multi-dependency milestone until every prerequisite is met", async () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { test: { command: CMD.pass } }, maxIterations: 5 },
      PROJECT,
    ));

    engine.start({
      goal: "app",
      milestones: [
        { key: "API", name: "api", dependsOn: [] },
        { key: "UI", name: "ui", dependsOn: [] },
        { key: "E2E", name: "end to end", dependsOn: ["API", "UI"] },
      ],
    });

    engine.checkpoint({ milestoneKey: "API", summary: "api done" });
    await engine.runGates({ milestoneKey: "API" });
    engine.markDone({ milestoneKey: "API" });

    // UI is still pending, so E2E must stay unavailable.
    expect(() => engine.checkpoint({ milestoneKey: "E2E", summary: "e2e" })).toThrow(/depends on UI/);

    engine.checkpoint({ milestoneKey: "UI", summary: "ui done" });
    await engine.runGates({ milestoneKey: "UI" });
    engine.markDone({ milestoneKey: "UI" });

    expect(engine.checkpoint({ milestoneKey: "E2E", summary: "e2e" }).milestone.key).toBe("E2E");
  });
});

describe("plan validation", () => {
  beforeEach(() => {
    ({ engine, db } = greenEngine());
  });

  it("rejects a dependency on a key that is not in the plan", () => {
    expect(() =>
      engine.start({
        goal: "app",
        milestones: [{ key: "M1", name: "first", dependsOn: ["GHOST"] }],
      }),
    ).toThrow(/not in the plan/);
  });

  it("rejects a milestone depending on itself", () => {
    expect(() =>
      engine.start({
        goal: "app",
        milestones: [{ key: "M1", name: "first", dependsOn: ["M1"] }],
      }),
    ).toThrow(/cannot depend on itself/);
  });

  it("rejects a two-node cycle", () => {
    expect(() =>
      engine.start({
        goal: "app",
        milestones: [
          { key: "A", name: "a", dependsOn: ["B"] },
          { key: "B", name: "b", dependsOn: ["A"] },
        ],
      }),
    ).toThrow(/cycle/);
  });

  it("rejects a longer cycle and names the milestones involved", () => {
    let message = "";
    try {
      engine.start({
        goal: "app",
        milestones: [
          { key: "A", name: "a", dependsOn: ["C"] },
          { key: "B", name: "b", dependsOn: ["A"] },
          { key: "C", name: "c", dependsOn: ["B"] },
        ],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("cycle");
    expect(message).toContain("A");
    expect(message).toContain("B");
    expect(message).toContain("C");
  });

  it("accepts a diamond, which is not a cycle", () => {
    const { milestones } = engine.start({
      goal: "app",
      milestones: [
        { key: "A", name: "a", dependsOn: [] },
        { key: "B", name: "b", dependsOn: ["A"] },
        { key: "C", name: "c", dependsOn: ["A"] },
        { key: "D", name: "d", dependsOn: ["B", "C"] },
      ],
    });

    expect(milestones).toHaveLength(4);
  });

  it("de-duplicates a repeated dependency key", () => {
    const { milestones } = engine.start({
      goal: "app",
      milestones: [
        { key: "A", name: "a", dependsOn: [] },
        { key: "B", name: "b", dependsOn: ["A", "A"] },
      ],
    });

    expect(milestones[1]?.dependsOn).toEqual(["A"]);
  });

  it("re-planning can rewire dependencies to unblock work", () => {
    engine.start({
      goal: "app",
      milestones: [
        { key: "M1", name: "first" },
        { key: "M2", name: "second" },
      ],
    });

    expect(engine.status().waitingOnDependencies).toHaveLength(1);

    engine.plan([
      { key: "M1", name: "first" },
      { key: "M2", name: "second", dependsOn: [] },
    ]);

    expect(engine.status().waitingOnDependencies).toHaveLength(0);
  });
});

describe("resolveDependencies", () => {
  it("applies the sequential default in plan order", () => {
    const resolved = resolveDependencies(
      [{ key: "A", name: "a" }, { key: "B", name: "b" }, { key: "C", name: "c" }],
      ["A", "B", "C"],
    );

    expect(resolved.get("A")).toEqual([]);
    expect(resolved.get("B")).toEqual(["A"]);
    expect(resolved.get("C")).toEqual(["B"]);
  });

  it("ignores blank entries in an explicit list", () => {
    const resolved = resolveDependencies(
      [{ key: "A", name: "a" }, { key: "B", name: "b", dependsOn: ["  ", "A", ""] }],
      ["A", "B"],
    );

    expect(resolved.get("B")).toEqual(["A"]);
  });

  it("throws StateError, not a generic Error, for bad input", () => {
    expect(() =>
      resolveDependencies([{ key: "A", name: "a", dependsOn: ["NOPE"] }], ["A"]),
    ).toThrow(StateError);
  });
});

describe("dependency-aware current milestone", () => {
  it("skips a dependency-blocked milestone when choosing what is next", async () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { test: { command: CMD.pass } }, maxIterations: 5 },
      PROJECT,
    ));

    engine.start({
      goal: "app",
      milestones: [
        { key: "M1", name: "first" },
        { key: "M2", name: "second" },
        { key: "SOLO", name: "independent", dependsOn: [] },
      ],
    });

    engine.checkpoint({ summary: "work on first" });
    await engine.runGates();
    engine.markDone();

    // M2 is now unblocked (M1 done) and comes before SOLO by position.
    expect(engine.status().current?.key).toBe("M2");
  });

  it("falls through to an independent milestone when earlier ones are blocked", () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { test: { command: CMD.pass } }, maxIterations: 5 },
      PROJECT,
    ));

    engine.start({
      goal: "app",
      milestones: [
        { key: "M1", name: "first", dependsOn: ["SOLO"] },
        { key: "SOLO", name: "independent", dependsOn: [] },
      ],
    });

    // M1 is listed first but waits on SOLO, so SOLO is what can start.
    expect(engine.status().current?.key).toBe("SOLO");
  });

  it("reports the prerequisite as current when a later milestone depends on it", () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { test: { command: CMD.pass } }, maxIterations: 5 },
      PROJECT,
    ));

    // M0 is listed first so the sequential default does not point back at M1.
    engine.start({
      goal: "app",
      milestones: [
        { key: "M0", name: "prerequisite", dependsOn: [] },
        { key: "M1", name: "only", dependsOn: ["M0"] },
      ],
    });

    const status = engine.status();

    expect(status.current?.key).toBe("M0");
    expect(status.waitingOnDependencies.map((entry) => entry.milestone.key)).toEqual(["M1"]);
  });

  it("explains that the sequential default closed a cycle", () => {
    ({ engine, db } = makeEngine(
      { version: 1, gates: { test: { command: CMD.pass } } },
      PROJECT,
    ));

    let message = "";
    try {
      // M1 depends on M0, but M0 is second so it defaults to depending on M1.
      engine.start({
        goal: "app",
        milestones: [
          { key: "M1", name: "only", dependsOn: ["M0"] },
          { key: "M0", name: "prerequisite" },
        ],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("cycle");
    expect(message).toContain("by default");
    expect(message).toContain("reordering");
  });
});
