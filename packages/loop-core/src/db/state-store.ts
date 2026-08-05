/**
 * StateStore — every read and write of loop state goes through here.
 *
 * Rules this file enforces:
 *  - Iterations and gate runs are append-only. History is evidence; rewriting
 *    it would defeat the point of having an audit trail.
 *  - Only one loop per project may be `active` at a time. Two concurrent loops
 *    means two competing definitions of "what's next".
 *  - Every statement is parameterized. Milestone keys and search terms come
 *    from an LLM, which is untrusted input by definition.
 */

import type { Database } from "bun:sqlite";
import {
  LOOP_STATUS,
  MILESTONE_STATUS,
  type BlockedReason,
  type ExistenceVerdict,
  type GateRun,
  type Iteration,
  type Loop,
  type LoopStatus,
  type MemoryEntry,
  type MemoryHit,
  type MemoryKind,
  type Milestone,
  type MilestoneStatus,
} from "../types.js";
import {
  serializeStringArray,
  toGateRun,
  toIteration,
  toLoop,
  toMemoryEntry,
  toMilestone,
  type GateRunRow,
  type IterationRow,
  type LoopRow,
  type MemoryRow,
  type MilestoneRow,
} from "./rows.js";
import { newId, nowIso, normalizeTags, truncateOutput } from "../util.js";

/** Raised when an operation would leave state inconsistent. */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateError";
  }
}

export type CreateLoopInput = {
  goal: string;
  projectRoot: string;
  maxIterations: number;
};

/**
 * Milestone as supplied by a caller.
 *
 * Optional fields accept explicit `undefined` because these values arrive from
 * JSON (an MCP tool call or a config file), where an absent key and a key set to
 * `undefined` are indistinguishable after parsing.
 */
export type MilestoneInput = {
  key: string;
  name: string;
  description?: string | undefined;
  validateCommand?: string | undefined;
  successCriteria?: string | undefined;
  /**
   * Keys that must finish first.
   *
   * Omit for the default (depends on the preceding milestone — sequential).
   * Pass `[]` to declare the milestone genuinely independent and runnable in
   * parallel. The distinction matters, so absent and empty are not the same.
   */
  dependsOn?: readonly string[] | undefined;
};

export type RecordIterationInput = {
  milestoneId: string;
  summary: string;
  filesTouched?: readonly string[];
  tokensUsed?: number;
  nextAction?: string;
};

export type RecordGateRunInput = {
  milestoneId: string;
  iterationId?: string;
  name: string;
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export type RememberInput = {
  content: string;
  kind: MemoryKind;
  tags?: readonly string[];
  loopId?: string;
  milestoneId?: string;
  source?: string;
  pinned?: boolean;
};

export type RecallOptions = {
  loopId?: string;
  kind?: MemoryKind;
  limit?: number;
};

export class StateStore {
  constructor(
    private readonly db: Database,
    private readonly maxOutputChars = 8_000,
  ) {}

  // ── Loops ────────────────────────────────────────────────────────────────

  /**
   * Create a loop and make it the active one.
   *
   * Rejects when another loop is already active for the project: resuming or
   * abandoning the old loop is a decision for the human, not a silent default.
   */
  createLoop(input: CreateLoopInput): Loop {
    const existing = this.getActiveLoop(input.projectRoot);
    if (existing !== undefined) {
      throw new StateError(
        `Loop ${existing.id} is already active for this project ` +
          `(goal: "${existing.goal}"). Complete, pause, or abandon it first.`,
      );
    }

    const timestamp = nowIso();
    const loop: Loop = {
      id: newId("loop"),
      goal: input.goal,
      status: LOOP_STATUS.ACTIVE,
      projectRoot: input.projectRoot,
      maxIterations: input.maxIterations,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.db
      .query(
        `INSERT INTO loops (id, goal, status, project_root, max_iterations, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        loop.id,
        loop.goal,
        loop.status,
        loop.projectRoot,
        loop.maxIterations,
        loop.createdAt,
        loop.updatedAt,
      );

    return loop;
  }

  getLoop(loopId: string): Loop | undefined {
    const row = this.db
      .query<LoopRow, [string]>(`SELECT * FROM loops WHERE id = ?`)
      .get(loopId);

    return row === null ? undefined : toLoop(row);
  }

  /** The single loop currently being worked, if any. */
  getActiveLoop(projectRoot: string): Loop | undefined {
    const row = this.db
      .query<LoopRow, [string, string]>(
        `SELECT * FROM loops
         WHERE project_root = ? AND status = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(projectRoot, LOOP_STATUS.ACTIVE);

    return row === null ? undefined : toLoop(row);
  }

  listLoops(projectRoot: string): Loop[] {
    return this.db
      .query<LoopRow, [string]>(
        `SELECT * FROM loops WHERE project_root = ? ORDER BY created_at DESC`,
      )
      .all(projectRoot)
      .map(toLoop);
  }

  setLoopStatus(loopId: string, status: LoopStatus): Loop {
    const loop = this.requireLoop(loopId);
    const timestamp = nowIso();
    const terminal =
      status === LOOP_STATUS.DONE ||
      status === LOOP_STATUS.FAILED ||
      status === LOOP_STATUS.ABANDONED;

    this.db
      .query(
        `UPDATE loops
         SET status = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, timestamp, terminal ? timestamp : null, loop.id);

    return this.requireLoop(loopId);
  }

  // ── Milestones ───────────────────────────────────────────────────────────

  /**
   * Replace the milestone plan for a loop.
   *
   * Refuses to discard milestones that already have work recorded against
   * them — losing a completed milestone's history would be a silent data loss
   * bug, and the agent re-planning mid-flight is exactly when that happens.
   *
   * Dependencies default to "the previous milestone in the plan", which makes an
   * ordinary plan strictly sequential without the author writing anything. An
   * explicit `dependsOn: []` opts a milestone out for parallel work.
   */
  setPlan(loopId: string, milestones: readonly MilestoneInput[]): Milestone[] {
    const loop = this.requireLoop(loopId);

    if (milestones.length === 0) {
      throw new StateError("A plan needs at least one milestone.");
    }

    const keys = milestones.map((milestone) => milestone.key.trim());
    if (keys.some((key) => key.length === 0)) {
      throw new StateError("Every milestone needs a non-empty key.");
    }

    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (duplicates.length > 0) {
      throw new StateError(`Duplicate milestone keys: ${[...new Set(duplicates)].join(", ")}`);
    }

    const resolved = resolveDependencies(milestones, keys);

    const withHistory = this.db
      .query<{ key: string }, [string]>(
        `SELECT DISTINCT m.key
         FROM milestones m
         JOIN iterations i ON i.milestone_id = m.id
         WHERE m.loop_id = ?`,
      )
      .all(loop.id)
      .map((row) => row.key);

    const orphaned = withHistory.filter((key) => !keys.includes(key));
    if (orphaned.length > 0) {
      throw new StateError(
        `Cannot drop milestone(s) with recorded iterations: ${orphaned.join(", ")}. ` +
          `Keep them in the plan or mark them skipped.`,
      );
    }

    const timestamp = nowIso();

    const apply = this.db.transaction(() => {
      // Milestones absent from the new plan and free of history are removed;
      // the rest are upserted so their status and history survive re-planning.
      const placeholders = keys.map(() => "?").join(", ");
      this.db
        .query(`DELETE FROM milestones WHERE loop_id = ? AND key NOT IN (${placeholders})`)
        .run(loop.id, ...keys);

      milestones.forEach((milestone, index) => {
        const key = milestone.key.trim();
        const dependsOn = serializeStringArray(resolved.get(key) ?? []);
        const existing = this.db
          .query<MilestoneRow, [string, string]>(
            `SELECT * FROM milestones WHERE loop_id = ? AND key = ?`,
          )
          .get(loop.id, key);

        if (existing === null) {
          this.db
            .query(
              `INSERT INTO milestones
                 (id, loop_id, key, name, description, status, position, depends_on,
                  validate_command, success_criteria, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              newId("ms"),
              loop.id,
              key,
              milestone.name,
              milestone.description ?? null,
              MILESTONE_STATUS.PENDING,
              index,
              dependsOn,
              milestone.validateCommand ?? null,
              milestone.successCriteria ?? null,
              timestamp,
              timestamp,
            );
          return;
        }

        this.db
          .query(
            `UPDATE milestones
             SET name = ?, description = ?, position = ?, depends_on = ?,
                 validate_command = ?, success_criteria = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            milestone.name,
            milestone.description ?? null,
            index,
            dependsOn,
            milestone.validateCommand ?? null,
            milestone.successCriteria ?? null,
            timestamp,
            existing.id,
          );
      });

      this.db.query(`UPDATE loops SET updated_at = ? WHERE id = ?`).run(timestamp, loop.id);
    });

    apply();

    return this.listMilestones(loop.id);
  }

  listMilestones(loopId: string): Milestone[] {
    return this.db
      .query<MilestoneRow, [string]>(
        `SELECT * FROM milestones WHERE loop_id = ? ORDER BY position ASC`,
      )
      .all(loopId)
      .map(toMilestone);
  }

  getMilestone(milestoneId: string): Milestone | undefined {
    const row = this.db
      .query<MilestoneRow, [string]>(`SELECT * FROM milestones WHERE id = ?`)
      .get(milestoneId);

    return row === null ? undefined : toMilestone(row);
  }

  /** Look a milestone up by its human-facing key, e.g. "M2". */
  getMilestoneByKey(loopId: string, key: string): Milestone | undefined {
    const row = this.db
      .query<MilestoneRow, [string, string]>(
        `SELECT * FROM milestones WHERE loop_id = ? AND key = ?`,
      )
      .get(loopId, key.trim());

    return row === null ? undefined : toMilestone(row);
  }

  /**
   * Whether a milestone's prerequisites are satisfied.
   *
   * A dependency counts as satisfied when it is `done` or `skipped`. Skipped
   * counts because skipping is an explicit, reasoned decision that the work will
   * not happen — treating it as permanently unmet would deadlock the plan.
   *
   * Returns the reason rather than a bare boolean so callers can tell the agent
   * *which* prerequisite to finish.
   */
  checkDependencies(milestoneId: string): BlockedReason | undefined {
    const milestone = this.requireMilestone(milestoneId);

    if (milestone.dependsOn.length === 0) {
      return undefined;
    }

    const siblings = this.listMilestones(milestone.loopId);
    const byKey = new Map(siblings.map((candidate) => [candidate.key, candidate]));

    const detail: BlockedReason["detail"] = [];

    for (const key of milestone.dependsOn) {
      const dependency = byKey.get(key);

      // A dependency on a key that no longer exists in the plan cannot be
      // satisfied and would block forever, so surface it rather than ignore it.
      if (dependency === undefined) {
        detail.push({ key, name: "(not in plan)", status: MILESTONE_STATUS.PENDING });
        continue;
      }

      const satisfied =
        dependency.status === MILESTONE_STATUS.DONE ||
        dependency.status === MILESTONE_STATUS.SKIPPED;

      if (!satisfied) {
        detail.push({
          key: dependency.key,
          name: dependency.name,
          status: dependency.status,
        });
      }
    }

    if (detail.length === 0) {
      return undefined;
    }

    return { unmet: detail.map((entry) => entry.key), detail };
  }

  /**
   * The milestone the agent should work on.
   *
   * Priority: in-flight work (active or blocked) before anything new, then the
   * first pending milestone whose dependencies are satisfied. Ordering within the
   * in-flight tier puts `active` first, so an agent that deliberately moved to a
   * different milestone is not dragged back on every subsequent call — a blocked
   * milestone stays visible in status and still cannot be marked done.
   *
   * A pending milestone with unmet dependencies is never returned: handing it to
   * the agent would invite work that the dependency guard then refuses.
   */
  getCurrentMilestone(loopId: string): Milestone | undefined {
    const inFlight = this.db
      .query<MilestoneRow, [string, string, string]>(
        `SELECT * FROM milestones
         WHERE loop_id = ? AND status IN (?, ?)
         ORDER BY
           CASE status WHEN 'active' THEN 0 ELSE 1 END,
           position ASC
         LIMIT 1`,
      )
      .get(loopId, MILESTONE_STATUS.ACTIVE, MILESTONE_STATUS.BLOCKED);

    if (inFlight !== null) {
      return toMilestone(inFlight);
    }

    const pending = this.db
      .query<MilestoneRow, [string, string]>(
        `SELECT * FROM milestones
         WHERE loop_id = ? AND status = ?
         ORDER BY position ASC`,
      )
      .all(loopId, MILESTONE_STATUS.PENDING)
      .map(toMilestone);

    return pending.find((candidate) => this.checkDependencies(candidate.id) === undefined);
  }

  /** Pending milestones held back by unmet dependencies, with the reason. */
  listBlockedByDependencies(loopId: string): Array<{ milestone: Milestone; reason: BlockedReason }> {
    const result: Array<{ milestone: Milestone; reason: BlockedReason }> = [];

    for (const milestone of this.listMilestones(loopId)) {
      if (milestone.status !== MILESTONE_STATUS.PENDING) {
        continue;
      }

      const reason = this.checkDependencies(milestone.id);
      if (reason !== undefined) {
        result.push({ milestone, reason });
      }
    }

    return result;
  }

  setMilestoneStatus(milestoneId: string, status: MilestoneStatus): Milestone {
    const milestone = this.requireMilestone(milestoneId);
    const timestamp = nowIso();
    const terminal = status === MILESTONE_STATUS.DONE || status === MILESTONE_STATUS.SKIPPED;

    this.db
      .query(
        `UPDATE milestones
         SET status = ?, updated_at = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, timestamp, terminal ? timestamp : null, milestone.id);

    this.db.query(`UPDATE loops SET updated_at = ? WHERE id = ?`).run(timestamp, milestone.loopId);

    return this.requireMilestone(milestoneId);
  }

  setExistenceVerdict(milestoneId: string, verdict: ExistenceVerdict): Milestone {
    const milestone = this.requireMilestone(milestoneId);

    this.db
      .query(`UPDATE milestones SET existence_verdict = ?, updated_at = ? WHERE id = ?`)
      .run(verdict, nowIso(), milestone.id);

    return this.requireMilestone(milestoneId);
  }

  // ── Iterations (append-only) ─────────────────────────────────────────────

  /** Append an iteration record. The number is assigned, never supplied. */
  recordIteration(input: RecordIterationInput): Iteration {
    const milestone = this.requireMilestone(input.milestoneId);
    const summary = input.summary.trim();

    if (summary.length === 0) {
      throw new StateError("An iteration needs a non-empty summary.");
    }

    const next = this.countIterations(milestone.id) + 1;
    const timestamp = nowIso();
    const id = newId("iter");

    this.db
      .query(
        `INSERT INTO iterations
           (id, loop_id, milestone_id, number, summary, files_touched,
            tokens_used, next_action, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        milestone.loopId,
        milestone.id,
        next,
        summary,
        serializeStringArray(input.filesTouched ?? []),
        input.tokensUsed ?? null,
        input.nextAction ?? null,
        timestamp,
      );

    // First recorded work flips a pending milestone to active.
    if (milestone.status === MILESTONE_STATUS.PENDING) {
      this.setMilestoneStatus(milestone.id, MILESTONE_STATUS.ACTIVE);
    }

    this.db.query(`UPDATE loops SET updated_at = ? WHERE id = ?`).run(timestamp, milestone.loopId);

    return this.requireIteration(id);
  }

  countIterations(milestoneId: string): number {
    const row = this.db
      .query<{ count: number }, [string]>(
        `SELECT COUNT(*) AS count FROM iterations WHERE milestone_id = ?`,
      )
      .get(milestoneId);

    return row?.count ?? 0;
  }

  listIterations(milestoneId: string): Iteration[] {
    return this.db
      .query<IterationRow, [string]>(
        `SELECT * FROM iterations WHERE milestone_id = ? ORDER BY number ASC`,
      )
      .all(milestoneId)
      .map(toIteration);
  }

  getLatestIteration(milestoneId: string): Iteration | undefined {
    const row = this.db
      .query<IterationRow, [string]>(
        `SELECT * FROM iterations WHERE milestone_id = ? ORDER BY number DESC LIMIT 1`,
      )
      .get(milestoneId);

    return row === null ? undefined : toIteration(row);
  }

  /** Total self-reported token spend for a loop. */
  sumTokensUsed(loopId: string): number {
    const row = this.db
      .query<{ total: number | null }, [string]>(
        `SELECT SUM(tokens_used) AS total FROM iterations WHERE loop_id = ?`,
      )
      .get(loopId);

    return row?.total ?? 0;
  }

  // ── Gate runs (append-only) ──────────────────────────────────────────────

  recordGateRun(input: RecordGateRunInput): GateRun {
    const milestone = this.requireMilestone(input.milestoneId);
    const id = newId("gate");

    this.db
      .query(
        `INSERT INTO gate_runs
           (id, loop_id, milestone_id, iteration_id, name, command, passed,
            exit_code, stdout, stderr, duration_ms, timed_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        milestone.loopId,
        milestone.id,
        input.iterationId ?? null,
        input.name,
        input.command,
        input.passed ? 1 : 0,
        input.exitCode,
        truncateOutput(input.stdout, this.maxOutputChars),
        truncateOutput(input.stderr, this.maxOutputChars),
        input.durationMs,
        input.timedOut ? 1 : 0,
        nowIso(),
      );

    return this.requireGateRun(id);
  }

  listGateRuns(milestoneId: string, limit = 50): GateRun[] {
    return this.db
      .query<GateRunRow, [string, number]>(
        `SELECT * FROM gate_runs
         WHERE milestone_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(milestoneId, limit)
      .map(toGateRun);
  }

  /**
   * Most recent run of each distinct gate for a milestone.
   *
   * This is what answers "are the gates currently green?" — earlier failures
   * of a gate that now passes must not keep a milestone blocked forever.
   */
  getLatestGateRuns(milestoneId: string): GateRun[] {
    return this.db
      .query<GateRunRow, [string]>(
        `SELECT g.* FROM gate_runs g
         JOIN (
           SELECT name, MAX(rowid) AS latest
           FROM gate_runs
           WHERE milestone_id = ?
           GROUP BY name
         ) newest ON newest.latest = g.rowid
         ORDER BY g.name ASC`,
      )
      .all(milestoneId)
      .map(toGateRun);
  }

  // ── Memory ───────────────────────────────────────────────────────────────

  /**
   * Store a memory, merging into an existing entry when the content already
   * exists verbatim for the same kind and scope. Agents repeat themselves;
   * a store that grows a duplicate row per restatement becomes useless.
   */
  remember(input: RememberInput): MemoryEntry {
    const content = input.content.trim();
    if (content.length === 0) {
      throw new StateError("A memory needs non-empty content.");
    }

    const tags = normalizeTags(input.tags ?? []);
    const timestamp = nowIso();

    const existing = this.db
      .query<MemoryRow, [string, string, string | null]>(
        `SELECT * FROM memories
         WHERE content = ? AND kind = ? AND IFNULL(loop_id, '') = IFNULL(?, '')
         LIMIT 1`,
      )
      .get(content, input.kind, input.loopId ?? null);

    if (existing !== null) {
      const mergedTags = normalizeTags([...JSON.parse(existing.tags) as string[], ...tags]);

      this.db
        .query(`UPDATE memories SET tags = ?, pinned = ?, updated_at = ? WHERE id = ?`)
        .run(
          serializeStringArray(mergedTags),
          input.pinned === true || existing.pinned === 1 ? 1 : 0,
          timestamp,
          existing.id,
        );

      return this.requireMemory(existing.id);
    }

    const id = newId("mem");

    this.db
      .query(
        `INSERT INTO memories
           (id, loop_id, milestone_id, kind, content, tags, source, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.loopId ?? null,
        input.milestoneId ?? null,
        input.kind,
        content,
        serializeStringArray(tags),
        input.source ?? "agent",
        input.pinned === true ? 1 : 0,
        timestamp,
        timestamp,
      );

    return this.requireMemory(id);
  }

  /**
   * Full-text search over memories, pinned entries first.
   *
   * The query is escaped into a quoted FTS5 phrase set rather than passed
   * through raw: FTS5 has its own operator syntax, and an agent writing
   * `auth OR "` would otherwise crash the search.
   */
  recall(query: string, options: RecallOptions = {}): MemoryHit[] {
    const limit = Math.min(Math.max(options.limit ?? 10, 1), 100);
    const match = toFtsQuery(query);

    if (match === undefined) {
      return this.recentMemories(options, limit).map((entry) => ({ ...entry, score: 0 }));
    }

    const filters: string[] = [];
    const params: Array<string | number> = [match];

    if (options.loopId !== undefined) {
      filters.push(`(m.loop_id = ? OR m.loop_id IS NULL)`);
      params.push(options.loopId);
    }

    if (options.kind !== undefined) {
      filters.push(`m.kind = ?`);
      params.push(options.kind);
    }

    const where = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";
    params.push(limit);

    const rows = this.db
      .query<MemoryRow & { score: number }, Array<string | number>>(
        `SELECT m.*, bm25(memories_fts) AS score
         FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ? ${where}
         ORDER BY m.pinned DESC, score ASC
         LIMIT ?`,
      )
      .all(...params);

    return rows.map((row) => ({ ...toMemoryEntry(row), score: row.score }));
  }

  /** Recent memories with no search term — the cold-start context dump. */
  recentMemories(options: RecallOptions = {}, limit = 20): MemoryEntry[] {
    const filters: string[] = [];
    const params: Array<string | number> = [];

    if (options.loopId !== undefined) {
      filters.push(`(loop_id = ? OR loop_id IS NULL)`);
      params.push(options.loopId);
    }

    if (options.kind !== undefined) {
      filters.push(`kind = ?`);
      params.push(options.kind);
    }

    const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
    params.push(Math.min(Math.max(limit, 1), 200));

    return this.db
      .query<MemoryRow, Array<string | number>>(
        `SELECT * FROM memories
         ${where}
         ORDER BY pinned DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(...params)
      .map(toMemoryEntry);
  }

  forget(memoryId: string): boolean {
    const existing = this.db
      .query<MemoryRow, [string]>(`SELECT * FROM memories WHERE id = ?`)
      .get(memoryId);

    if (existing === null) {
      return false;
    }

    this.db.query(`DELETE FROM memories WHERE id = ?`).run(memoryId);
    return true;
  }

  // ── Required-getters ─────────────────────────────────────────────────────
  // Throw instead of returning undefined, for paths where absence is a bug.

  requireLoop(loopId: string): Loop {
    const loop = this.getLoop(loopId);
    if (loop === undefined) {
      throw new StateError(`Loop not found: ${loopId}`);
    }
    return loop;
  }

  requireMilestone(milestoneId: string): Milestone {
    const milestone = this.getMilestone(milestoneId);
    if (milestone === undefined) {
      throw new StateError(`Milestone not found: ${milestoneId}`);
    }
    return milestone;
  }

  private requireIteration(iterationId: string): Iteration {
    const row = this.db
      .query<IterationRow, [string]>(`SELECT * FROM iterations WHERE id = ?`)
      .get(iterationId);

    if (row === null) {
      throw new StateError(`Iteration not found: ${iterationId}`);
    }
    return toIteration(row);
  }

  private requireGateRun(gateRunId: string): GateRun {
    const row = this.db
      .query<GateRunRow, [string]>(`SELECT * FROM gate_runs WHERE id = ?`)
      .get(gateRunId);

    if (row === null) {
      throw new StateError(`Gate run not found: ${gateRunId}`);
    }
    return toGateRun(row);
  }

  private requireMemory(memoryId: string): MemoryEntry {
    const row = this.db
      .query<MemoryRow, [string]>(`SELECT * FROM memories WHERE id = ?`)
      .get(memoryId);

    if (row === null) {
      throw new StateError(`Memory not found: ${memoryId}`);
    }
    return toMemoryEntry(row);
  }
}

/**
 * Convert a free-text query into a safe FTS5 MATCH expression.
 *
 * Every token is wrapped in double quotes (with inner quotes doubled), so
 * FTS5 operators in user text are treated as literals. Returns undefined when
 * nothing searchable remains, so callers can fall back to recency.
 */
export function toFtsQuery(query: string): string | undefined {
  const tokens = query
    .split(/[^\p{L}\p{N}_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return undefined;
  }

  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
}

/**
 * Work out each milestone's dependency list, applying the sequential default.
 *
 * Rules:
 *  - `dependsOn` omitted  → depends on the previous milestone in the plan.
 *  - `dependsOn: []`      → explicitly independent; may run in parallel.
 *  - `dependsOn: [keys]`  → exactly those, validated against the plan.
 *
 * Validates that every referenced key exists, that nothing depends on itself,
 * and that the graph is acyclic. A cycle would deadlock the loop with no
 * milestone ever startable, and an agent authoring a plan is entirely capable of
 * writing one by accident.
 */
export function resolveDependencies(
  milestones: readonly MilestoneInput[],
  keys: readonly string[],
): Map<string, string[]> {
  const known = new Set(keys);
  const resolved = new Map<string, string[]>();
  /** Keys whose dependency came from the sequential default, not the author. */
  const defaulted = new Set<string>();

  milestones.forEach((milestone, index) => {
    const key = keys[index] ?? milestone.key.trim();

    if (milestone.dependsOn === undefined) {
      const previous = index > 0 ? keys[index - 1] : undefined;
      resolved.set(key, previous !== undefined ? [previous] : []);
      if (previous !== undefined) {
        defaulted.add(key);
      }
      return;
    }

    const declared = normalizeDependencyKeys(milestone.dependsOn);

    for (const dependency of declared) {
      if (dependency === key) {
        throw new StateError(`Milestone "${key}" cannot depend on itself.`);
      }

      if (!known.has(dependency)) {
        throw new StateError(
          `Milestone "${key}" depends on "${dependency}", which is not in the plan. ` +
            `Available keys: ${[...known].join(", ")}`,
        );
      }
    }

    resolved.set(key, declared);
  });

  const cycle = findCycle(resolved);
  if (cycle !== undefined) {
    throw new StateError(describeCycle(cycle, defaulted));
  }

  return resolved;
}

/**
 * Explain a dependency cycle.
 *
 * When a cycle runs through a milestone that got its dependency from the
 * sequential default, the author did not write the cycle — declaring a backward
 * dependency created it. Saying so is the difference between a usable error and a
 * confusing one, because the offending edge is not visible in the plan.
 */
function describeCycle(cycle: readonly string[], defaulted: ReadonlySet<string>): string {
  const path = cycle.join(" → ");
  const fromDefault = cycle.filter((key) => defaulted.has(key));

  if (fromDefault.length === 0) {
    return (
      `Milestone dependencies form a cycle: ${path}. ` +
      `No milestone in a cycle can ever start.`
    );
  }

  return (
    `Milestone dependencies form a cycle: ${path}. ` +
    `Note that ${fromDefault.join(", ")} depend${fromDefault.length === 1 ? "s" : ""} on the ` +
    `preceding milestone by default. Declaring a dependency on a milestone listed later closes ` +
    `the loop. Fix it by reordering the plan so prerequisites come first, or by giving ` +
    `${fromDefault.join(", ")} an explicit dependsOn list.`
  );
}

function normalizeDependencyKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();

  for (const raw of keys) {
    const key = raw.trim();
    if (key.length > 0) {
      seen.add(key);
    }
  }

  return [...seen];
}

/**
 * Depth-first search for a dependency cycle.
 *
 * Returns the cycle path for the error message when one exists, so the author is
 * told which milestones are involved rather than just that a cycle exists.
 */
function findCycle(graph: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const VISITING = 1;
  const DONE = 2;
  const marks = new Map<string, number>();
  const path: string[] = [];

  const walk = (node: string): string[] | undefined => {
    const mark = marks.get(node);

    if (mark === DONE) {
      return undefined;
    }

    if (mark === VISITING) {
      const start = path.indexOf(node);
      return [...path.slice(start === -1 ? 0 : start), node];
    }

    marks.set(node, VISITING);
    path.push(node);

    for (const dependency of graph.get(node) ?? []) {
      const found = walk(dependency);
      if (found !== undefined) {
        return found;
      }
    }

    path.pop();
    marks.set(node, DONE);
    return undefined;
  };

  for (const node of graph.keys()) {
    const found = walk(node);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}
