#!/usr/bin/env bun
/**
 * StackForge MCP server (stdio transport).
 *
 * Exposes the loop engine as tools any MCP client can call: Claude Code, Cursor,
 * Windsurf, Claude Desktop, Cline. There is no network listener and no API key —
 * the process is spawned by the client, speaks JSON-RPC over stdin/stdout, and
 * writes only to a SQLite file inside the project.
 *
 * Why stdio and not HTTP: an HTTP server would be a network-exposed endpoint
 * needing authentication and CORS decisions. stdio inherits the client's trust
 * boundary — if you can spawn the process, you already have local file access.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LoopEngine, loadConfig } from "@stackforge/loop-core";
import { TOOLS } from "./tools.js";

const SERVER_NAME = "stackforge-loop";
const SERVER_VERSION = "0.1.0";

/**
 * Resolve the project to operate on.
 *
 * Precedence: explicit `--project` flag, then `STACKFORGE_PROJECT_ROOT`, then the
 * process working directory. MCP clients differ in what cwd they hand a spawned
 * server, so the flag exists for configs that need to be explicit.
 */
function resolveProjectRoot(argv: readonly string[]): string {
  const flagIndex = argv.indexOf("--project");

  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("--project requires a directory path");
    }
    return value;
  }

  const fromEnv = process.env["STACKFORGE_PROJECT_ROOT"]?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }

  return process.cwd();
}

async function main(): Promise<void> {
  const startDir = resolveProjectRoot(process.argv.slice(2));
  const { config, projectRoot, configPath, found } = loadConfig(startDir);

  // stderr only. stdout is the JSON-RPC channel — a stray console.log there
  // corrupts the protocol stream and the client disconnects with a parse error.
  process.stderr.write(
    `[${SERVER_NAME}] project: ${projectRoot}\n` +
      `[${SERVER_NAME}] config: ${found ? configPath : "none (using defaults, no gates)"}\n` +
      `[${SERVER_NAME}] gates: ${
        config.gates.length > 0 ? config.gates.map((gate) => gate.name).join(", ") : "(none)"
      }\n`,
  );

  const engine = new LoopEngine({ projectRoot, config });
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      // The SDK's generic inference over a dynamic tool list does not narrow to
      // each tool's own shape; every handler re-validates with its own zod schema
      // before touching the engine, so the cast is contained and safe.
      (async (args: Record<string, unknown>) =>
        tool.handler(args ?? {}, engine)) as never,
    );
  }

  const shutdown = (): void => {
    engine.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(new StdioServerTransport());
  process.stderr.write(`[${SERVER_NAME}] ready — ${TOOLS.length} tools registered\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[${SERVER_NAME}] fatal: ${message}\n`);
  process.exit(1);
});
