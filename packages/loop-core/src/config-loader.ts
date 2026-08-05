/**
 * Config file discovery and loading.
 *
 * Walks up from a starting directory looking for `stackforge.json`, the same way
 * package managers find `package.json`. This lets the MCP server and CLI be
 * invoked from any subdirectory of a project and still agree on where the
 * project root is.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import {
  DEFAULT_CONFIG_FILENAME,
  STARTER_CONFIG,
  emptyLoopConfig,
  parseLoopConfig,
  type LoopConfig,
} from "./config.js";

export type LoadedConfig = {
  config: LoopConfig;
  /** Directory containing the config file, or the search origin if none found. */
  projectRoot: string;
  /** Absolute path to the config file, when one exists. */
  configPath?: string;
  /** False when defaults were used because no file was found. */
  found: boolean;
};

/** Find `stackforge.json` by walking up from `startDir` to the filesystem root. */
export function findConfigFile(startDir: string): string | undefined {
  let current = resolve(startDir);
  const { root } = parse(current);

  for (;;) {
    const candidate = join(current, DEFAULT_CONFIG_FILENAME);

    if (existsSync(candidate)) {
      return candidate;
    }

    if (current === root) {
      return undefined;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }

    current = parent;
  }
}

/**
 * Load config, falling back to gate-less defaults when no file exists.
 *
 * A missing config is not an error: `resume`, `status`, and the memory tools all
 * work without one. Only gate execution requires configured gates, and that path
 * raises its own error with instructions.
 */
export function loadConfig(startDir: string): LoadedConfig {
  const configPath = findConfigFile(startDir);

  if (configPath === undefined) {
    return {
      config: emptyLoopConfig(),
      projectRoot: resolve(startDir),
      found: false,
    };
  }

  const raw = readFileSync(configPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${configPath} is not valid JSON: ${message}`);
  }

  return {
    config: parseLoopConfig(parsed),
    projectRoot: dirname(configPath),
    configPath,
    found: true,
  };
}

/**
 * Write a starter config. Never overwrites an existing file — a config that
 * has been tuned is more valuable than our defaults.
 */
export function writeStarterConfig(projectRoot: string): { path: string; created: boolean } {
  const path = join(resolve(projectRoot), DEFAULT_CONFIG_FILENAME);

  if (existsSync(path)) {
    return { path, created: false };
  }

  writeFileSync(path, `${JSON.stringify(STARTER_CONFIG, null, 2)}\n`, "utf8");
  return { path, created: true };
}
