/**
 * Row shapes as stored in SQLite, plus mappers to domain types.
 *
 * SQLite has no boolean and no array, so rows use INTEGER 0/1 and JSON text.
 * Keeping the conversion in one file means the rest of the codebase never has
 * to remember that `passed` is really a number.
 */

import type {
  ExistenceVerdict,
  GateRun,
  Iteration,
  Loop,
  LoopStatus,
  MemoryEntry,
  MemoryKind,
  Milestone,
  MilestoneStatus,
} from "../types.js";

export type LoopRow = {
  id: string;
  goal: string;
  status: string;
  project_root: string;
  max_iterations: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type MilestoneRow = {
  id: string;
  loop_id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  position: number;
  depends_on: string;
  validate_command: string | null;
  success_criteria: string | null;
  existence_verdict: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type IterationRow = {
  id: string;
  loop_id: string;
  milestone_id: string;
  number: number;
  summary: string;
  files_touched: string;
  tokens_used: number | null;
  next_action: string | null;
  created_at: string;
};

export type GateRunRow = {
  id: string;
  loop_id: string;
  milestone_id: string;
  iteration_id: string | null;
  name: string;
  command: string;
  passed: number;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: number;
  created_at: string;
};

export type MemoryRow = {
  id: string;
  loop_id: string | null;
  milestone_id: string | null;
  kind: string;
  content: string;
  tags: string;
  source: string;
  pinned: number;
  created_at: string;
  updated_at: string;
};

/** Parse a JSON text column that should hold an array of strings. */
function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function serializeStringArray(values: readonly string[]): string {
  return JSON.stringify([...values]);
}

export function toLoop(row: LoopRow): Loop {
  return {
    id: row.id,
    goal: row.goal,
    status: row.status as LoopStatus,
    projectRoot: row.project_root,
    maxIterations: row.max_iterations,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
  };
}

export function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    loopId: row.loop_id,
    key: row.key,
    name: row.name,
    ...(row.description !== null ? { description: row.description } : {}),
    status: row.status as MilestoneStatus,
    position: row.position,
    dependsOn: parseStringArray(row.depends_on),
    ...(row.validate_command !== null ? { validateCommand: row.validate_command } : {}),
    ...(row.success_criteria !== null ? { successCriteria: row.success_criteria } : {}),
    ...(row.existence_verdict !== null
      ? { existenceVerdict: row.existence_verdict as ExistenceVerdict }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
  };
}

export function toIteration(row: IterationRow): Iteration {
  return {
    id: row.id,
    loopId: row.loop_id,
    milestoneId: row.milestone_id,
    number: row.number,
    summary: row.summary,
    filesTouched: parseStringArray(row.files_touched),
    ...(row.tokens_used !== null ? { tokensUsed: row.tokens_used } : {}),
    ...(row.next_action !== null ? { nextAction: row.next_action } : {}),
    createdAt: row.created_at,
  };
}

export function toGateRun(row: GateRunRow): GateRun {
  return {
    id: row.id,
    loopId: row.loop_id,
    milestoneId: row.milestone_id,
    ...(row.iteration_id !== null ? { iterationId: row.iteration_id } : {}),
    name: row.name,
    command: row.command,
    passed: row.passed === 1,
    exitCode: row.exit_code,
    stdout: row.stdout,
    stderr: row.stderr,
    durationMs: row.duration_ms,
    timedOut: row.timed_out === 1,
    createdAt: row.created_at,
  };
}

export function toMemoryEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    ...(row.loop_id !== null ? { loopId: row.loop_id } : {}),
    ...(row.milestone_id !== null ? { milestoneId: row.milestone_id } : {}),
    kind: row.kind as MemoryKind,
    content: row.content,
    tags: parseStringArray(row.tags),
    source: row.source,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
