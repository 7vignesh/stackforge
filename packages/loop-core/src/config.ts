/**
 * Loop configuration — `stackforge.json` in the project root.
 *
 * Deliberately tiny. No API keys, no model names, no provider config.
 * The user's own coding agent supplies the intelligence; this file only
 * describes how to *prove* the work is done.
 */

import { z } from "zod";

/**
 * A gate is a shell command plus a pass condition.
 * `exit 0` means pass. Anything else is a failure with the stderr attached.
 */
export const GateConfigSchema = z.object({
  /** Shell command to run, e.g. "npx tsc --noEmit". */
  command: z.string().min(1),
  /** Hard timeout; a hung test suite must not hang the loop. */
  timeoutMs: z.number().int().positive().max(30 * 60_000).default(120_000),
  /**
   * Ordering hint. Lower runs first so cheap checks fail fast —
   * no point running 200 tests when the project does not compile.
   */
  order: z.number().int().default(100),
  /**
   * When false the gate is recorded but never blocks progress.
   * Useful for lint while a codebase is being cleaned up.
   */
  blocking: z.boolean().default(true),
});

export type GateConfig = z.infer<typeof GateConfigSchema>;

/**
 * Gates accept either shorthand (`"typecheck": "tsc --noEmit"`) or the full
 * object form. Shorthand keeps the common case a single line.
 */
const GateEntrySchema = z.union([z.string().min(1), GateConfigSchema.partial({ timeoutMs: true, order: true, blocking: true })]);

export const LoopConfigSchema = z.object({
  /** Schema version so future migrations can detect old files. */
  version: z.literal(1).default(1),
  /** Named gates. Keys become the gate name in results. */
  gates: z.record(z.string(), GateEntrySchema).default({}),
  /** Hard ceiling on iterations per milestone before surfacing to the human. */
  maxIterations: z.number().int().positive().max(100).default(10),
  /**
   * Working directory for gate commands, relative to the config file.
   * Defaults to the config file's own directory.
   */
  cwd: z.string().default("."),
  /** Cap on captured output per stream, in characters. */
  maxOutputChars: z.number().int().positive().default(8_000),
});

export type LoopConfigInput = z.input<typeof LoopConfigSchema>;

/** Normalized config: every gate is a full object, sorted by run order. */
export type LoopConfig = {
  version: 1;
  gates: Array<GateConfig & { name: string }>;
  maxIterations: number;
  cwd: string;
  maxOutputChars: number;
};

export const DEFAULT_CONFIG_FILENAME = "stackforge.json";

/** Sensible starting gates for a TypeScript project. */
export const STARTER_CONFIG: LoopConfigInput = {
  version: 1,
  gates: {
    typecheck: { command: "npx tsc --noEmit", order: 10 },
    test: { command: "npm test", order: 20 },
    lint: { command: "npx eslint . --quiet", order: 30, blocking: false },
  },
  maxIterations: 10,
  cwd: ".",
};

/**
 * Parse and normalize a raw config object.
 * Throws a readable error when the shape is wrong — a broken config should
 * fail loudly at startup, not silently skip gates at runtime.
 */
export function parseLoopConfig(raw: unknown): LoopConfig {
  const parsed = LoopConfigSchema.parse(raw);

  const gates = Object.entries(parsed.gates)
    .map(([name, entry]): GateConfig & { name: string } => {
      if (typeof entry === "string") {
        return {
          name,
          command: entry,
          timeoutMs: 120_000,
          order: 100,
          blocking: true,
        };
      }

      return {
        name,
        command: entry.command,
        timeoutMs: entry.timeoutMs ?? 120_000,
        order: entry.order ?? 100,
        blocking: entry.blocking ?? true,
      };
    })
    .sort((a, b) => (a.order === b.order ? a.name.localeCompare(b.name) : a.order - b.order));

  return {
    version: parsed.version,
    gates,
    maxIterations: parsed.maxIterations,
    cwd: parsed.cwd,
    maxOutputChars: parsed.maxOutputChars,
  };
}

/** Config used when no `stackforge.json` exists: no gates, safe defaults. */
export function emptyLoopConfig(): LoopConfig {
  return parseLoopConfig({ version: 1, gates: {} });
}
