/**
 * Gate runner — executes real commands and reports real exit codes.
 *
 * This is the load-bearing idea of the whole system. An agent claiming "tests
 * should pass" is a sentence; `npm test` returning 0 is a fact. Everything here
 * exists to produce facts.
 *
 * Security note: commands come from the project's own `stackforge.json`, which
 * is trusted the same way `package.json` scripts are. Commands are NOT accepted
 * from MCP callers — see `gates/execute.ts` for why that boundary matters.
 */

import { spawn, spawnSync } from "node:child_process";
import type { GateConfig } from "../config.js";
import { truncateOutput } from "../util.js";

/**
 * Kill a process and everything it spawned.
 *
 * `child.kill()` signals only the shell we started, not the test runner the
 * shell launched. On POSIX we kill the process group (negative pid, enabled by
 * `detached`); on Windows there are no process groups, so we hand the job to
 * `taskkill /T`. Without this a timed-out gate keeps burning CPU in the
 * background while we report it as killed.
 */
function killTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  try {
    // Negative pid targets the whole process group.
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone. Nothing to clean up.
    }
  }
}

export type GateOutcome = {
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  /** False when the gate failed but is configured as non-blocking. */
  blocking: boolean;
};

export type RunGateOptions = {
  /** Working directory for the command. */
  cwd: string;
  /** Cap on captured characters per stream. */
  maxOutputChars: number;
  /** Extra environment variables layered over the current process env. */
  env?: Record<string, string>;
};

/**
 * Run a single gate command to completion.
 *
 * Uses a shell because gate commands are written the way a developer would type
 * them (`npm test -- --grep auth`, pipes, `&&`). That is the same trust level as
 * an npm script. The command string never originates from an MCP client.
 */
export async function runGate(
  gate: GateConfig & { name: string },
  options: RunGateOptions,
): Promise<GateOutcome> {
  const startedAt = Date.now();

  return new Promise<GateOutcome>((resolve) => {
    const child = spawn(gate.command, {
      cwd: options.cwd,
      shell: true,
      env: { ...process.env, ...(options.env ?? {}) },
      windowsHide: true,
      // POSIX: put the shell in its own process group so we can kill the whole
      // tree on timeout. Windows has no groups; taskkill /T handles it instead.
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    // Cap in-memory growth: a runaway process printing megabytes must not take
    // the host down. We keep a generous multiple of the reported budget so the
    // tail-truncation still has material to work with.
    const hardCap = Math.max(options.maxOutputChars * 4, 64_000);

    const appendStdout = (chunk: string): void => {
      stdout = stdout.length > hardCap ? stdout.slice(-hardCap) + chunk : stdout + chunk;
    };

    const appendStderr = (chunk: string): void => {
      stderr = stderr.length > hardCap ? stderr.slice(-hardCap) + chunk : stderr + chunk;
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => appendStdout(chunk));
    child.stderr?.on("data", (chunk: string) => appendStderr(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      // SIGTERM first so a well-behaved runner can flush output, then SIGKILL
      // the survivors. Both target the tree, not just the shell.
      killTree(child.pid, "SIGTERM");
      const escalation = setTimeout(() => {
        if (!settled) {
          killTree(child.pid, "SIGKILL");
        }
      }, 2_000);
      escalation.unref();
    }, gate.timeoutMs);

    const settle = (exitCode: number): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const passed = exitCode === 0 && !timedOut;

      resolve({
        name: gate.name,
        command: gate.command,
        passed,
        exitCode,
        stdout: truncateOutput(stdout, options.maxOutputChars),
        stderr: truncateOutput(stderr, options.maxOutputChars),
        durationMs: Date.now() - startedAt,
        timedOut,
        blocking: gate.blocking,
      });
    };

    child.on("error", (error: Error) => {
      // Spawn failure (command not found, permission denied). Surfacing this as
      // a gate failure with the message in stderr keeps the caller's handling
      // uniform: one shape for "did not pass", whatever the reason.
      appendStderr(`failed to spawn: ${error.message}\n`);
      settle(-1);
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      // A timeout is decided by us, not by how the OS happened to report the
      // death. Windows `taskkill /F` yields an exit code while POSIX signals
      // yield null, so checking `timedOut` first keeps both platforms identical.
      if (timedOut) {
        appendStderr(`gate timed out after ${gate.timeoutMs}ms\n`);
        settle(124); // conventional timeout exit code
        return;
      }

      if (code !== null) {
        settle(code);
        return;
      }

      // Killed by a signal we did not send: no exit code available.
      // 137 mirrors the shell convention for SIGKILL (128+9).
      appendStderr(`terminated by signal ${signal ?? "unknown"}\n`);
      settle(137);
    });
  });
}

export type GateSuiteResult = {
  outcomes: GateOutcome[];
  /** True when no blocking gate failed. Non-blocking failures do not count. */
  passed: boolean;
  /** Gates that were never run because an earlier blocking gate failed. */
  skipped: string[];
  totalDurationMs: number;
};

/**
 * Run gates in configured order, stopping at the first blocking failure.
 *
 * Fail-fast is deliberate: if the project does not typecheck there is no
 * information in running 200 tests, and the agent needs the compiler error in
 * front of it, not buried under unrelated test noise.
 */
export async function runGateSuite(
  gates: ReadonlyArray<GateConfig & { name: string }>,
  options: RunGateOptions,
): Promise<GateSuiteResult> {
  const outcomes: GateOutcome[] = [];
  const skipped: string[] = [];
  const startedAt = Date.now();

  let halted = false;

  for (const gate of gates) {
    if (halted) {
      skipped.push(gate.name);
      continue;
    }

    const outcome = await runGate(gate, options);
    outcomes.push(outcome);

    if (!outcome.passed && outcome.blocking) {
      halted = true;
    }
  }

  return {
    outcomes,
    passed: outcomes.every((outcome) => outcome.passed || !outcome.blocking),
    skipped,
    totalDurationMs: Date.now() - startedAt,
  };
}

/**
 * Build the feedback an agent should act on after a gate failure.
 *
 * Returns the raw compiler/test output, not a summary. The agent needs the
 * same thing a developer would read in their terminal: file, line, message.
 */
export function formatGateFailure(outcome: GateOutcome): string {
  const header = outcome.timedOut
    ? `Gate "${outcome.name}" TIMED OUT after ${outcome.durationMs}ms`
    : `Gate "${outcome.name}" FAILED with exit code ${outcome.exitCode}`;

  const body = [outcome.stderr.trim(), outcome.stdout.trim()]
    .filter((section) => section.length > 0)
    .join("\n\n");

  return [
    header,
    `command: ${outcome.command}`,
    "",
    body.length > 0 ? body : "(no output captured)",
  ].join("\n");
}
