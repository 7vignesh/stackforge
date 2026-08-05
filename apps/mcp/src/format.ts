/**
 * Formatting helpers for MCP tool responses.
 *
 * MCP returns text content to the model, so the shape of that text is the
 * actual API surface an agent sees. Two rules throughout:
 *
 *  1. Lead with the verdict. An agent skimming a long response must not have to
 *     infer whether something passed.
 *  2. On failure, include the raw command output. A summary of a compiler error
 *     is strictly less useful than the error.
 */

import type {
  GateResult,
  Iteration,
  LoopStatus,
  MemoryEntry,
  MemoryHit,
  Milestone,
  PreflightResult,
  ResumeContext,
} from "@stackforge/loop-core";

/** MCP text-content envelope. */
export type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function textResponse(text: string): ToolResponse {
  return { content: [{ type: "text", text }] };
}

/**
 * Error response.
 *
 * `isError` is set so the client can style it, but the message is still plain
 * text the model can read and act on — an agent that cannot see why a call was
 * rejected will simply retry the same way.
 */
export function errorResponse(text: string): ToolResponse {
  return { content: [{ type: "text", text }], isError: true };
}

const STATUS_MARK: Record<string, string> = {
  pending: "· ",
  active: "▸ ",
  blocked: "✗ ",
  done: "✓ ",
  skipped: "— ",
};

export type FormatMilestonesOptions = {
  currentId?: string;
  /** Keys held back by unmet prerequisites, marked so the plan reads correctly. */
  waitingKeys?: ReadonlySet<string>;
};

function milestoneLine(milestone: Milestone, options: FormatMilestonesOptions): string {
  const mark = STATUS_MARK[milestone.status] ?? "· ";
  const pointer = milestone.id === options.currentId ? "  ← current" : "";
  const waiting =
    options.waitingKeys?.has(milestone.key) === true
      ? `  (waiting on ${milestone.dependsOn.join(", ")})`
      : "";
  const after =
    milestone.dependsOn.length > 0 && waiting === ""
      ? `  (after ${milestone.dependsOn.join(", ")})`
      : "";

  return `${mark}${milestone.key}  ${milestone.name} [${milestone.status}]${after}${waiting}${pointer}`;
}

export function formatMilestones(
  milestones: readonly Milestone[],
  options: FormatMilestonesOptions = {},
): string {
  if (milestones.length === 0) {
    return "(no milestones planned yet)";
  }

  return milestones.map((milestone) => milestoneLine(milestone, options)).join("\n");
}

/** Keys of milestones currently held back by prerequisites. */
function waitingKeysOf(status: LoopStatus): Set<string> {
  return new Set(status.waitingOnDependencies.map((entry) => entry.milestone.key));
}

export function formatStatus(status: LoopStatus): string {
  const lines: string[] = [
    `Goal: ${status.loop.goal}`,
    `Loop: ${status.loop.id} [${status.loop.status}]`,
    `Progress: ${status.progress.done}/${status.progress.total} milestones done`,
    "",
    formatMilestones(status.milestones, {
      ...(status.current !== undefined ? { currentId: status.current.id } : {}),
      waitingKeys: waitingKeysOf(status),
    }),
  ];

  if (status.current !== undefined) {
    lines.push(
      "",
      `Current milestone: ${status.current.key} — ${status.current.name}`,
      `Iterations: ${status.iterationCount}/${status.maxIterations} ` +
        `(${status.iterationsRemaining} remaining)`,
    );

    if (status.current.validateCommand !== undefined) {
      lines.push(`Validate command: ${status.current.validateCommand}`);
    }

    if (status.latestIteration?.nextAction !== undefined) {
      lines.push(`Planned next action: ${status.latestIteration.nextAction}`);
    }
  }

  lines.push("", formatGateSummary(status));

  if (status.waitingOnDependencies.length > 0) {
    lines.push("", "Not yet startable:");
    for (const entry of status.waitingOnDependencies) {
      const detail = entry.reason.detail
        .map((dependency) => `${dependency.key} is ${dependency.status}`)
        .join(", ");
      lines.push(`  ${entry.milestone.key} — waiting on ${detail}`);
    }
  }

  if (status.tokensUsed > 0) {
    lines.push(`Tokens reported: ${status.tokensUsed}`);
  }

  return lines.join("\n");
}

function formatGateSummary(status: LoopStatus): string {
  if (status.latestGates.length === 0) {
    return "Gates: never run for this milestone. Run them before claiming anything works.";
  }

  const summary = status.latestGates
    .map((run) => `${run.name}=${run.passed ? "pass" : `FAIL(exit ${run.exitCode})`}`)
    .join("  ");

  return `Gates: ${summary}\nAll blocking gates green: ${status.gatesGreen ? "yes" : "no"}`;
}

/**
 * Gate results.
 *
 * On failure this returns the captured stderr/stdout verbatim, because that text
 * is the thing the agent needs to fix the code.
 */
export function formatGateResult(result: GateResult): string {
  const header = result.passed ? "GATES PASSED" : "GATES FAILED";

  const rows = result.outcomes.map((outcome) => {
    const verdict = outcome.passed
      ? "pass"
      : outcome.timedOut
        ? `TIMEOUT after ${outcome.durationMs}ms`
        : `FAIL exit ${outcome.exitCode}`;
    const flag = outcome.blocking ? "" : " (non-blocking)";
    return `  ${outcome.name}: ${verdict}${flag}  [${outcome.durationMs}ms]`;
  });

  const lines = [
    `${header} — milestone ${result.milestone.key} (${result.milestone.status})`,
    "",
    ...rows,
  ];

  if (result.skipped.length > 0) {
    lines.push("", `Not run (earlier blocking gate failed): ${result.skipped.join(", ")}`);
  }

  if (!result.passed) {
    lines.push(
      "",
      "─── failure output ───",
      result.feedback,
      "─────────────────────",
      "",
      "Fix the cause, then run the gates again. Do not mark this milestone done.",
    );
  }

  return lines.join("\n");
}

export function formatPreflight(result: PreflightResult): string {
  const lines = [
    `EXISTENCE VERDICT: ${result.verdict.toUpperCase()}`,
    `Milestone: ${result.milestone.key} — ${result.milestone.name}`,
    "",
    result.guidance,
  ];

  if (result.evidence.length > 0) {
    lines.push("", "Matching prior work:");
    for (const hit of result.evidence) {
      lines.push(`  • ${hit.content}`);
    }
  }

  return lines.join("\n");
}

export function formatMemories(entries: readonly (MemoryEntry | MemoryHit)[]): string {
  if (entries.length === 0) {
    return "No matching memories.";
  }

  return entries
    .map((entry) => {
      const tags = entry.tags.length > 0 ? `  [${entry.tags.join(", ")}]` : "";
      const pin = entry.pinned ? " 📌" : "";
      return `• (${entry.kind})${pin} ${entry.content}${tags}\n  id: ${entry.id}`;
    })
    .join("\n");
}

export function formatResume(context: ResumeContext): string {
  const lines = [
    "═══ LOOP CONTEXT (cold start) ═══",
    "",
    context.brief,
    "",
    "─── plan ───",
    formatMilestones(context.milestones, {
      ...(context.current !== undefined ? { currentId: context.current.id } : {}),
      waitingKeys: waitingKeysOf(context),
    }),
  ];

  if (context.configuredGates.length > 0) {
    lines.push(
      "",
      "─── gates ───",
      ...context.configuredGates.map(
        (gate) => `  ${gate.name}: ${gate.command}${gate.blocking ? "" : "  (non-blocking)"}`,
      ),
    );
  }

  if (context.recentIterations.length > 0) {
    lines.push("", "─── recent iterations ───", formatIterations(context.recentIterations));
  }

  if (context.memories.length > 0) {
    lines.push("", "─── remembered ───", formatMemories(context.memories));
  }

  lines.push(
    "",
    "═════════════════════════════════",
    "You have the full picture. Continue from the planned next action.",
  );

  return lines.join("\n");
}

export function formatIterations(iterations: readonly Iteration[]): string {
  if (iterations.length === 0) {
    return "(no iterations recorded)";
  }

  return iterations
    .map((iteration) => {
      const parts = [`  #${iteration.number}: ${iteration.summary}`];

      if (iteration.filesTouched.length > 0) {
        parts.push(`    files: ${iteration.filesTouched.join(", ")}`);
      }

      if (iteration.nextAction !== undefined) {
        parts.push(`    next: ${iteration.nextAction}`);
      }

      return parts.join("\n");
    })
    .join("\n");
}
