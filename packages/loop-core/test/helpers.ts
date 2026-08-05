/// <reference types="bun" />
/**
 * Shared test helpers.
 *
 * Every test gets an isolated in-memory database, so tests never touch the
 * developer's real `.stackforge/loop.db` and can run in parallel.
 */

import { openDatabase } from "../src/db/database.js";
import { LoopEngine } from "../src/engine.js";
import { parseLoopConfig, type LoopConfigInput } from "../src/config.js";
import { StateStore } from "../src/db/state-store.js";
import type { Database } from "bun:sqlite";

/** Cross-platform "succeed" and "fail" shell commands for gate tests. */
export const CMD = {
  /** Exits 0 with output on stdout. */
  pass: process.platform === "win32" ? "cmd /c echo ok" : "echo ok",
  /** Exits non-zero. */
  fail:
    process.platform === "win32"
      ? "cmd /c \"echo boom 1>&2 & exit 3\""
      : "sh -c 'echo boom >&2; exit 3'",
  /** Sleeps long enough to trip a short timeout. */
  slow: process.platform === "win32" ? "cmd /c ping -n 12 127.0.0.1 > nul" : "sh -c 'sleep 10'",
} as const;

export function makeDb(): Database {
  return openDatabase({ projectRoot: process.cwd(), memory: true });
}

export function makeStore(db: Database = makeDb()): { db: Database; store: StateStore } {
  return { db, store: new StateStore(db) };
}

export type TestEngine = {
  engine: LoopEngine;
  db: Database;
};

/** An engine backed by an in-memory database, rooted at the given directory. */
export function makeEngine(
  configInput: LoopConfigInput = { version: 1, gates: {} },
  projectRoot: string = process.cwd(),
): TestEngine {
  const db = makeDb();
  const engine = new LoopEngine({
    projectRoot,
    config: parseLoopConfig(configInput),
    db,
  });

  return { engine, db };
}

/** Standard three-milestone plan used across tests. */
export const SAMPLE_PLAN = [
  { key: "M1", name: "JWT login", validateCommand: undefined },
  { key: "M2", name: "Refresh rotation" },
  { key: "M3", name: "Role based access" },
] as const;
