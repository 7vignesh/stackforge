/// <reference types="bun" />
/**
 * Config parsing and discovery.
 *
 * Config is the only user-authored input to the engine, so its failure modes
 * matter: a typo must surface at load time, not as a silently skipped gate.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CONFIG_FILENAME,
  emptyLoopConfig,
  parseLoopConfig,
  STARTER_CONFIG,
} from "../src/config.js";
import { findConfigFile, loadConfig, writeStarterConfig } from "../src/config-loader.js";

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), "sf-config-"));
}

describe("parseLoopConfig", () => {
  it("expands shorthand string gates into full objects with defaults", () => {
    const config = parseLoopConfig({
      version: 1,
      gates: { typecheck: "tsc --noEmit" },
    });

    expect(config.gates).toHaveLength(1);
    expect(config.gates[0]).toEqual({
      name: "typecheck",
      command: "tsc --noEmit",
      timeoutMs: 120_000,
      order: 100,
      blocking: true,
    });
  });

  it("sorts gates by order so cheap checks fail fast", () => {
    const config = parseLoopConfig({
      version: 1,
      gates: {
        test: { command: "npm test", order: 20 },
        typecheck: { command: "tsc --noEmit", order: 10 },
        lint: { command: "eslint .", order: 30 },
      },
    });

    expect(config.gates.map((gate) => gate.name)).toEqual(["typecheck", "test", "lint"]);
  });

  it("breaks order ties alphabetically for deterministic runs", () => {
    const config = parseLoopConfig({
      version: 1,
      gates: {
        zebra: { command: "echo z", order: 5 },
        alpha: { command: "echo a", order: 5 },
      },
    });

    expect(config.gates.map((gate) => gate.name)).toEqual(["alpha", "zebra"]);
  });

  it("preserves an explicit blocking:false flag", () => {
    const config = parseLoopConfig({
      version: 1,
      gates: { lint: { command: "eslint .", blocking: false } },
    });

    expect(config.gates[0]?.blocking).toBe(false);
  });

  it("applies defaults when fields are omitted entirely", () => {
    const config = parseLoopConfig({ version: 1 });

    expect(config.gates).toEqual([]);
    expect(config.maxIterations).toBe(10);
    expect(config.cwd).toBe(".");
    expect(config.maxOutputChars).toBe(8_000);
  });

  it("rejects an empty gate command instead of running a no-op", () => {
    expect(() => parseLoopConfig({ version: 1, gates: { bad: "" } })).toThrow();
  });

  it("rejects a non-positive maxIterations", () => {
    expect(() => parseLoopConfig({ version: 1, maxIterations: 0 })).toThrow();
  });

  it("rejects an unsupported version so old files fail loudly", () => {
    expect(() => parseLoopConfig({ version: 2, gates: {} })).toThrow();
  });

  it("clamps an absurd timeout via schema bounds", () => {
    expect(() =>
      parseLoopConfig({ version: 1, gates: { t: { command: "x", timeoutMs: 999_999_999 } } }),
    ).toThrow();
  });

  it("emptyLoopConfig produces a valid gate-less config", () => {
    const config = emptyLoopConfig();
    expect(config.gates).toEqual([]);
    expect(config.version).toBe(1);
  });

  it("STARTER_CONFIG is itself valid", () => {
    const config = parseLoopConfig(STARTER_CONFIG);
    expect(config.gates.map((gate) => gate.name)).toEqual(["typecheck", "test", "lint"]);
    expect(config.gates.find((gate) => gate.name === "lint")?.blocking).toBe(false);
  });
});

describe("config discovery", () => {
  it("finds a config in the starting directory", () => {
    const root = tempProject();
    try {
      const path = join(root, DEFAULT_CONFIG_FILENAME);
      writeFileSync(path, JSON.stringify({ version: 1, gates: {} }));

      expect(findConfigFile(root)).toBe(path);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("walks up from a nested directory to the project root", () => {
    const root = tempProject();
    try {
      writeFileSync(join(root, DEFAULT_CONFIG_FILENAME), JSON.stringify({ version: 1 }));
      const nested = join(root, "packages", "api", "src");
      mkdirSync(nested, { recursive: true });

      const loaded = loadConfig(nested);

      expect(loaded.found).toBe(true);
      expect(loaded.projectRoot).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to defaults when no config exists", () => {
    const root = tempProject();
    try {
      const loaded = loadConfig(root);

      expect(loaded.found).toBe(false);
      expect(loaded.configPath).toBeUndefined();
      expect(loaded.config.gates).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports the file path when the JSON is malformed", () => {
    const root = tempProject();
    try {
      const path = join(root, DEFAULT_CONFIG_FILENAME);
      writeFileSync(path, "{ not json");

      expect(() => loadConfig(root)).toThrow(/not valid JSON/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a starter config and refuses to clobber an existing one", () => {
    const root = tempProject();
    try {
      const first = writeStarterConfig(root);
      expect(first.created).toBe(true);

      const loaded = loadConfig(root);
      expect(loaded.config.gates).toHaveLength(3);

      const second = writeStarterConfig(root);
      expect(second.created).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
