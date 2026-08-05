/**
 * Core domain types for the loop engine.
 *
 * Design note: every type here is a plain data shape that can be persisted to
 * SQLite and handed to an MCP client as JSON. No classes, no methods, nothing
 * that needs a live runtime to make sense. State must survive a process exit.
 */

/** Lifecycle of a loop (one goal being worked through). */
export const LOOP_STATUS = {
  ACTIVE: "active",
  PAUSED: "paused",
  DONE: "done",
  FAILED: "failed",
  ABANDONED: "abandoned",
} as const;

export type LoopStatus = (typeof LOOP_STATUS)[keyof typeof LOOP_STATUS];

/** Lifecycle of a single milestone inside a loop. */
export const MILESTONE_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  BLOCKED: "blocked",
  DONE: "done",
  SKIPPED: "skipped",
} as const;

export type MilestoneStatus = (typeof MILESTONE_STATUS)[keyof typeof MILESTONE_STATUS];

/**
 * Result of the existence pre-flight: "is this already built?"
 * Borrowed from genesis-kit's G0 gate. Prevents the agent rebuilding
 * something it shipped three sessions ago and has since forgotten.
 */
export const EXISTENCE_VERDICT = {
  UNBUILT: "unbuilt",
  PARTIAL: "partial",
  BUILT: "built",
} as const;

export type ExistenceVerdict = (typeof EXISTENCE_VERDICT)[keyof typeof EXISTENCE_VERDICT];

/** Categories of memory. Mirrors what a developer actually needs to recall. */
export const MEMORY_KIND = {
  /** A choice that constrains future work ("we use bcrypt cost 12"). */
  DECISION: "decision",
  /** A durable truth about the project ("JWT lives in an httpOnly cookie"). */
  FACT: "fact",
  /** A reusable approach ("all routes validate with a zod schema first"). */
  PATTERN: "pattern",
  /** A capability that now exists and must not be rebuilt. */
  BUILT: "built",
  /** A trap discovered the hard way ("the SSE client reconnects twice"). */
  GOTCHA: "gotcha",
} as const;

export type MemoryKind = (typeof MEMORY_KIND)[keyof typeof MEMORY_KIND];

/** A goal being executed as a bounded loop. */
export type Loop = {
  id: string;
  goal: string;
  status: LoopStatus;
  /** Absolute path of the project this loop drives. */
  projectRoot: string;
  maxIterations: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

/** One shippable slice of a loop, with the command that proves it works. */
export type Milestone = {
  id: string;
  loopId: string;
  /** Human-facing short name, e.g. "M1" or "jwt-login". */
  key: string;
  name: string;
  description?: string;
  status: MilestoneStatus;
  /** Ordering within the loop; lower runs first. */
  position: number;
  /**
   * Keys of milestones that must finish before this one may start.
   *
   * Defaults to the immediately preceding milestone, making a plan sequential
   * unless the author says otherwise. Set to `[]` for work that genuinely has no
   * prerequisite and may proceed in parallel.
   */
  dependsOn: string[];
  /**
   * The exact command that proves this milestone is done.
   * If you cannot write one, the milestone is too vague — split it.
   */
  validateCommand?: string;
  /** Free-form success criteria the verifier and human can read. */
  successCriteria?: string;
  existenceVerdict?: ExistenceVerdict;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

/**
 * Why a milestone cannot be started yet.
 *
 * Returned instead of thrown when a caller is *asking* about readiness, so the
 * agent can be told which prerequisite to finish rather than just being refused.
 */
export type BlockedReason = {
  /** Dependency keys that are not yet done or skipped. */
  unmet: string[];
  /** Current status of each unmet dependency, for a useful message. */
  detail: Array<{ key: string; name: string; status: MilestoneStatus }>;
};

/** One pass of work against a milestone. Append-only; never rewritten. */
export type Iteration = {
  id: string;
  loopId: string;
  milestoneId: string;
  /** 1-based counter within the milestone. */
  number: number;
  /** What the agent did this pass. */
  summary: string;
  /** Concrete deltas: files touched, tests added, errors removed. */
  filesTouched: string[];
  /** Optional self-reported token spend. */
  tokensUsed?: number;
  /** The very next concrete step, so a cold session can resume mid-flight. */
  nextAction?: string;
  createdAt: string;
};

/** The outcome of running one gate command. Evidence, not opinion. */
export type GateRun = {
  id: string;
  loopId: string;
  milestoneId: string;
  iterationId?: string;
  /** Gate name from config, e.g. "typecheck" | "test" | "lint". */
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  /** Truncated stdout — enough to prove it ran, not enough to blow context. */
  stdout: string;
  /** Truncated stderr — this is what gets fed back to the agent on failure. */
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  createdAt: string;
};

/** A durable note about the project that outlives any single session. */
export type MemoryEntry = {
  id: string;
  /** Loop-scoped when tied to one goal; null when project-wide. */
  loopId?: string;
  milestoneId?: string;
  kind: MemoryKind;
  content: string;
  tags: string[];
  /** Where this came from, e.g. "agent", "gate-failure", "human". */
  source: string;
  /** Pinned entries always surface in recall, regardless of score. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A memory entry plus its relevance score from a search. */
export type MemoryHit = MemoryEntry & {
  /** Lower is a better match (SQLite FTS5 bm25 convention). */
  score: number;
};
