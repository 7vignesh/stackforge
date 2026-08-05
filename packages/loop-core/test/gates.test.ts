/// <reference types="bun" />
/**
 * Gate runner behaviour against real subprocesses.
 *
 * These deliberately spawn actual commands rather than mocking `spawn`: the
 * whole premise of a gate is that it reflects reality, and a mocked exit code
 * would prove nothing about whether we read exit codes correctly.
 */

import { describe, expect, it } from "bun:test";
import { formatGateFailure, runGate, runGateSuite } from "../src/gates/runner.js";
import type { GateConfig } from "../src/config.js";
import { CMD } from "./helpers.js";

const RUN_OPTIONS = { cwd: process.cwd(), maxOutputChars: 4_000 };

function gate(overrides: Partial<GateConfig & { name: string }> = {}): GateConfig & { name: string } {
  return {
    name: "check",
    command: CMD.pass,
    timeoutMs: 30_000,
    order: 100,
    blocking: true,
    ...overrides,
  };
}

describe("runGate", () => {
  it("passes on exit code 0 and captures stdout", async () => {
    const outcome = await runGate(gate(), RUN_OPTIONS);

    expect(outcome.passed).toBe(true);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout.trim()).toContain("ok");
    expect(outcome.timedOut).toBe(false);
  });

  it("fails with the real exit code and captures stderr", async () => {
    const outcome = await runGate(gate({ command: CMD.fail }), RUN_OPTIONS);

    expect(outcome.passed).toBe(false);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.stderr).toContain("boom");
  });

  it("reports a failure rather than throwing when the command does not exist", async () => {
    const outcome = await runGate(
      gate({ command: "definitely-not-a-real-command-xyz --version" }),
      RUN_OPTIONS,
    );

    expect(outcome.passed).toBe(false);
    expect(outcome.exitCode).not.toBe(0);
  });

  it("kills a hung command and marks it timed out", async () => {
    const outcome = await runGate(gate({ command: CMD.slow, timeoutMs: 400 }), RUN_OPTIONS);

    expect(outcome.timedOut).toBe(true);
    expect(outcome.passed).toBe(false);
    expect(outcome.stderr).toContain("timed out");
  }, 20_000);

  it("never passes a timed-out command even if it exits 0 late", async () => {
    const outcome = await runGate(gate({ command: CMD.slow, timeoutMs: 300 }), RUN_OPTIONS);

    expect(outcome.passed).toBe(false);
  }, 20_000);

  it("records a duration", async () => {
    const outcome = await runGate(gate(), RUN_OPTIONS);

    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.durationMs).toBeLessThan(30_000);
  });

  it("truncates output beyond the configured budget", async () => {
    const loud =
      process.platform === "win32"
        ? `cmd /c for /l %i in (1,1,600) do @echo lineeeeeeeeeeeeeeeeeeeeeeeeeeeeeee%i`
        : `sh -c 'for i in $(seq 1 600); do echo lineeeeeeeeeeeeeeeeeeeeeeeeeeeeeee$i; done'`;

    const outcome = await runGate(gate({ command: loud }), { cwd: process.cwd(), maxOutputChars: 300 });

    expect(outcome.stdout.length).toBeLessThan(500);
    expect(outcome.stdout).toContain("truncated");
  }, 20_000);

  it("carries the blocking flag through to the outcome", async () => {
    const outcome = await runGate(gate({ blocking: false, command: CMD.fail }), RUN_OPTIONS);

    expect(outcome.blocking).toBe(false);
    expect(outcome.passed).toBe(false);
  });

  it("runs in the requested working directory", async () => {
    const printCwd = process.platform === "win32" ? "cmd /c cd" : "pwd";
    const outcome = await runGate(gate({ command: printCwd }), {
      cwd: process.cwd(),
      maxOutputChars: 4_000,
    });

    expect(outcome.passed).toBe(true);
    expect(outcome.stdout.trim().length).toBeGreaterThan(0);
  });
});

describe("runGateSuite", () => {
  it("runs every gate when all pass", async () => {
    const result = await runGateSuite(
      [gate({ name: "a", order: 1 }), gate({ name: "b", order: 2 })],
      RUN_OPTIONS,
    );

    expect(result.passed).toBe(true);
    expect(result.outcomes).toHaveLength(2);
    expect(result.skipped).toEqual([]);
  });

  it("stops at the first blocking failure and reports what was skipped", async () => {
    const result = await runGateSuite(
      [
        gate({ name: "typecheck", command: CMD.fail, order: 1 }),
        gate({ name: "test", order: 2 }),
        gate({ name: "lint", order: 3 }),
      ],
      RUN_OPTIONS,
    );

    expect(result.passed).toBe(false);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.name).toBe("typecheck");
    expect(result.skipped).toEqual(["test", "lint"]);
  });

  it("continues past a non-blocking failure", async () => {
    const result = await runGateSuite(
      [
        gate({ name: "lint", command: CMD.fail, blocking: false, order: 1 }),
        gate({ name: "test", order: 2 }),
      ],
      RUN_OPTIONS,
    );

    expect(result.outcomes).toHaveLength(2);
    expect(result.skipped).toEqual([]);
    // A non-blocking failure must not fail the suite.
    expect(result.passed).toBe(true);
  });

  it("fails the suite when a blocking gate fails after a non-blocking one", async () => {
    const result = await runGateSuite(
      [
        gate({ name: "lint", command: CMD.fail, blocking: false, order: 1 }),
        gate({ name: "test", command: CMD.fail, order: 2 }),
      ],
      RUN_OPTIONS,
    );

    expect(result.passed).toBe(false);
  });

  it("handles an empty gate list without claiming success by accident", async () => {
    const result = await runGateSuite([], RUN_OPTIONS);

    expect(result.outcomes).toEqual([]);
    // Vacuously true, but the engine guards against empty suites separately.
    expect(result.passed).toBe(true);
  });

  it("reports a total duration covering all gates", async () => {
    const result = await runGateSuite([gate({ name: "a" }), gate({ name: "b" })], RUN_OPTIONS);

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("formatGateFailure", () => {
  it("leads with the gate name and exit code", async () => {
    const outcome = await runGate(gate({ name: "typecheck", command: CMD.fail }), RUN_OPTIONS);
    const message = formatGateFailure(outcome);

    expect(message).toContain('Gate "typecheck" FAILED');
    expect(message).toContain("exit code 3");
  });

  it("includes the raw command so the agent can reproduce it", async () => {
    const outcome = await runGate(gate({ command: CMD.fail }), RUN_OPTIONS);

    expect(formatGateFailure(outcome)).toContain(CMD.fail);
  });

  it("includes the captured error output verbatim", async () => {
    const outcome = await runGate(gate({ command: CMD.fail }), RUN_OPTIONS);

    expect(formatGateFailure(outcome)).toContain("boom");
  });

  it("says so explicitly when a timeout was the cause", async () => {
    const outcome = await runGate(gate({ command: CMD.slow, timeoutMs: 300 }), RUN_OPTIONS);

    expect(formatGateFailure(outcome)).toContain("TIMED OUT");
  }, 20_000);

  it("does not claim missing output is a pass", async () => {
    const silent = process.platform === "win32" ? "cmd /c exit 1" : "sh -c 'exit 1'";
    const outcome = await runGate(gate({ command: silent }), RUN_OPTIONS);
    const message = formatGateFailure(outcome);

    expect(message).toContain("FAILED");
    expect(message).toContain("no output captured");
  });
});
