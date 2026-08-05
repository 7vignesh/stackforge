/**
 * Database bootstrap and migrations.
 *
 * Uses `bun:sqlite` — bundled with the runtime, so there is no native module
 * to compile and no dependency to audit. The database is a single file in the
 * project (default `.stackforge/loop.db`), which means loop state is as local
 * and as portable as the repo itself.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_DB_DIRNAME = ".stackforge";
export const DEFAULT_DB_FILENAME = "loop.db";

/** Resolve the database path for a project root, honouring an env override. */
export function resolveDatabasePath(projectRoot: string): string {
  const override = process.env["STACKFORGE_DB_PATH"]?.trim();
  if (override !== undefined && override.length > 0) {
    return resolve(override);
  }

  return join(resolve(projectRoot), DEFAULT_DB_DIRNAME, DEFAULT_DB_FILENAME);
}

/**
 * Each migration is applied exactly once, in order, inside a transaction.
 * Append new migrations; never edit an existing one — someone's database
 * has already run it.
 */
type Migration = {
  version: number;
  name: string;
  up: (db: Database) => void;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial-schema",
    up: (db) => {
      db.run(`
        CREATE TABLE loops (
          id            TEXT PRIMARY KEY,
          goal          TEXT NOT NULL,
          status        TEXT NOT NULL,
          project_root  TEXT NOT NULL,
          max_iterations INTEGER NOT NULL,
          created_at    TEXT NOT NULL,
          updated_at    TEXT NOT NULL,
          completed_at  TEXT
        );
      `);

      db.run(`CREATE INDEX idx_loops_status ON loops(status);`);

      db.run(`
        CREATE TABLE milestones (
          id                TEXT PRIMARY KEY,
          loop_id           TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
          key               TEXT NOT NULL,
          name              TEXT NOT NULL,
          description       TEXT,
          status            TEXT NOT NULL,
          position          INTEGER NOT NULL,
          validate_command  TEXT,
          success_criteria  TEXT,
          existence_verdict TEXT,
          created_at        TEXT NOT NULL,
          updated_at        TEXT NOT NULL,
          completed_at      TEXT,
          UNIQUE (loop_id, key)
        );
      `);

      db.run(`CREATE INDEX idx_milestones_loop ON milestones(loop_id, position);`);
      db.run(`CREATE INDEX idx_milestones_status ON milestones(loop_id, status);`);

      db.run(`
        CREATE TABLE iterations (
          id            TEXT PRIMARY KEY,
          loop_id       TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
          milestone_id  TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
          number        INTEGER NOT NULL,
          summary       TEXT NOT NULL,
          files_touched TEXT NOT NULL,
          tokens_used   INTEGER,
          next_action   TEXT,
          created_at    TEXT NOT NULL,
          UNIQUE (milestone_id, number)
        );
      `);

      db.run(`CREATE INDEX idx_iterations_milestone ON iterations(milestone_id, number);`);

      db.run(`
        CREATE TABLE gate_runs (
          id           TEXT PRIMARY KEY,
          loop_id      TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
          milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
          iteration_id TEXT REFERENCES iterations(id) ON DELETE SET NULL,
          name         TEXT NOT NULL,
          command      TEXT NOT NULL,
          passed       INTEGER NOT NULL,
          exit_code    INTEGER NOT NULL,
          stdout       TEXT NOT NULL,
          stderr       TEXT NOT NULL,
          duration_ms  INTEGER NOT NULL,
          timed_out    INTEGER NOT NULL,
          created_at   TEXT NOT NULL
        );
      `);

      db.run(`CREATE INDEX idx_gate_runs_milestone ON gate_runs(milestone_id, created_at);`);

      db.run(`
        CREATE TABLE memories (
          id           TEXT PRIMARY KEY,
          loop_id      TEXT REFERENCES loops(id) ON DELETE CASCADE,
          milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,
          kind         TEXT NOT NULL,
          content      TEXT NOT NULL,
          tags         TEXT NOT NULL,
          source       TEXT NOT NULL,
          pinned       INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
      `);

      db.run(`CREATE INDEX idx_memories_kind ON memories(kind);`);
      db.run(`CREATE INDEX idx_memories_loop ON memories(loop_id);`);

      // FTS5 mirror of `memories.content` + tags for relevance search.
      // `content=''` makes it contentless: we store the text once in `memories`
      // and keep only the index here, kept in sync by the triggers below.
      db.run(`
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          content,
          tags,
          content='',
          tokenize='porter unicode61'
        );
      `);

      db.run(`
        CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
          INSERT INTO memories_fts(rowid, content, tags)
          VALUES (new.rowid, new.content, new.tags);
        END;
      `);

      db.run(`
        CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags)
          VALUES ('delete', old.rowid, old.content, old.tags);
        END;
      `);

      db.run(`
        CREATE TRIGGER memories_fts_update AFTER UPDATE ON memories BEGIN
          INSERT INTO memories_fts(memories_fts, rowid, content, tags)
          VALUES ('delete', old.rowid, old.content, old.tags);
          INSERT INTO memories_fts(rowid, content, tags)
          VALUES (new.rowid, new.content, new.tags);
        END;
      `);
    },
  },
  {
    version: 2,
    name: "milestone-dependencies",
    up: (db) => {
      // Stored as a JSON array of milestone keys. Keys rather than ids so a plan
      // can be authored (and re-authored) without knowing generated ids.
      db.run(`ALTER TABLE milestones ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]';`);

      // Existing rows predate dependencies and were authored under sequential
      // assumptions, so make that explicit: each milestone depends on the one
      // before it. Backfilling with the same rule new plans get avoids two
      // different meanings of an empty dependency list.
      const rows = db
        .query<{ id: string; loop_id: string; key: string; position: number }, []>(
          `SELECT id, loop_id, key, position FROM milestones ORDER BY loop_id, position`,
        )
        .all();

      const previousByLoop = new Map<string, string>();

      for (const row of rows) {
        const previous = previousByLoop.get(row.loop_id);

        if (previous !== undefined) {
          db.query(`UPDATE milestones SET depends_on = ? WHERE id = ?`).run(
            JSON.stringify([previous]),
            row.id,
          );
        }

        previousByLoop.set(row.loop_id, row.key);
      }
    },
  },
];

/** Highest migration version this build knows how to apply. */
export const SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, migration) => Math.max(max, migration.version),
  0,
);

function currentVersion(db: Database): number {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version;").get();
  return row?.user_version ?? 0;
}

/**
 * Apply every migration newer than the database's recorded version.
 *
 * Each migration runs in its own transaction so a failure leaves the database
 * at the last good version rather than half-migrated.
 */
export function migrate(db: Database): number {
  const from = currentVersion(db);

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) {
      continue;
    }

    const run = db.transaction(() => {
      migration.up(db);
      // PRAGMA does not accept bound parameters, and the value is an integer
      // from our own migration list — never user input.
      db.run(`PRAGMA user_version = ${migration.version};`);
    });

    run();
  }

  return currentVersion(db);
}

export type OpenDatabaseOptions = {
  /** Project root used to derive the default database location. */
  projectRoot: string;
  /** Explicit database path; overrides the derived default. */
  path?: string;
  /** In-memory database for tests. Nothing is written to disk. */
  memory?: boolean;
};

/**
 * Open (creating if needed) a migrated database.
 *
 * WAL mode lets the CLI read state while an MCP server holds the same file
 * open — a reader no longer blocks on a writer.
 */
export function openDatabase(options: OpenDatabaseOptions): Database {
  if (options.memory === true) {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON;");
    migrate(db);
    return db;
  }

  const path = options.path ?? resolveDatabasePath(options.projectRoot);
  mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA foreign_keys = ON;");
  db.run("PRAGMA busy_timeout = 5000;");
  migrate(db);

  return db;
}
