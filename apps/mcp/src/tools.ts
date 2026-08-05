/**
 * MCP tool definitions.
 *
 * Each tool is a thin translation layer: parse arguments, call the engine, format
 * the result. All rules live in `@stackforge/loop-core` so the CLI and the MCP
 * server cannot drift apart in what they permit.
 *
 * Security boundary worth stating plainly: no tool accepts a shell command. Gate
 * commands come only from the project's `stackforge.json`, which the developer
 * controls and which sits in version control. If an MCP caller could pass a
 * command, a prompt-injected agent would have arbitrary code execution — so the
 * only thing a caller may do is name a gate that already exists in the config.
 */

import { z } from "zod";
import {
  LOOP_STATUS,
  LoopError,
  MEMORY_KIND,
  StateError,
  type LoopEngine,
  type MemoryKind,
} from "@stackforge/loop-core";
import {
  errorResponse,
  formatGateResult,
  formatIterations,
  formatMemories,
  formatPreflight,
  formatResume,
  formatStatus,
  textResponse,
  type ToolResponse,
} from "./format.js";

/** A tool as registered with the MCP server. */
export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  /**
   * Per-field zod schemas. The MCP SDK converts this shape into the JSON Schema
   * the client sees, so the `.describe()` text on each field is what the agent
   * actually reads when deciding how to call the tool.
   */
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>, engine: LoopEngine) => Promise<ToolResponse> | ToolResponse;
};

const MEMORY_KINDS = [
  MEMORY_KIND.DECISION,
  MEMORY_KIND.FACT,
  MEMORY_KIND.PATTERN,
  MEMORY_KIND.BUILT,
  MEMORY_KIND.GOTCHA,
] as const;

const MilestoneInputSchema = z.object({
  key: z.string().min(1).describe("Short stable identifier, e.g. 'M1'."),
  name: z.string().min(1).describe("One-line outcome of this milestone."),
  description: z.string().optional().describe("Optional detail about the work."),
  validateCommand: z
    .string()
    .optional()
    .describe(
      "The exact command that proves this milestone works, e.g. 'npm test -- --grep auth'. " +
        "If you cannot write one, the milestone is too vague — split it.",
    ),
  successCriteria: z.string().optional().describe("What 'done' means, in prose."),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe(
      "Milestone keys that must finish first. OMIT for the default, which is to depend on the " +
        "preceding milestone — that makes the plan sequential and is usually what you want. " +
        "Pass [] only when this work genuinely has no prerequisite and can proceed in parallel. " +
        "Work cannot start on a milestone whose prerequisites are unfinished.",
    ),
});

/**
 * Run a handler, converting engine errors into readable tool errors.
 *
 * Engine errors are deliberate, instructive messages ("gates never run", "not
 * converging"). Passing them through unchanged is what lets an agent correct
 * itself instead of retrying blindly.
 */
async function guard(run: () => Promise<ToolResponse> | ToolResponse): Promise<ToolResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LoopError || error instanceof StateError) {
      return errorResponse(error.message);
    }

    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(`Unexpected failure: ${message}`);
  }
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "loop_start",
    title: "Start a loop",
    description:
      "Begin a new loop for a goal, optionally with its milestone plan. Call this once per goal. " +
      "Slice the goal into milestones yourself — you have the codebase in context. Every milestone " +
      "should carry the exact command that proves it works. Milestones run in order by default: " +
      "each depends on the one before it, so work cannot start on a milestone whose prerequisite " +
      "is still unfinished. Fails if a loop is already active.",
    inputSchema: {
      goal: z.string().min(1).describe("What this loop will accomplish."),
      milestones: z
        .array(MilestoneInputSchema)
        .optional()
        .describe("Ordered milestones. Can be supplied later via loop_plan."),
      maxIterations: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Per-milestone iteration ceiling. Defaults to the config value."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z
          .object({
            goal: z.string().min(1),
            milestones: z.array(MilestoneInputSchema).optional(),
            maxIterations: z.number().int().positive().optional(),
          })
          .parse(args);

        const { loop, milestones } = engine.start({
          goal: input.goal,
          ...(input.milestones !== undefined ? { milestones: input.milestones } : {}),
          ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
        });

        const lines = [
          `Loop started: ${loop.id}`,
          `Goal: ${loop.goal}`,
          `Iteration cap: ${loop.maxIterations} per milestone`,
          "",
        ];

        if (milestones.length === 0) {
          lines.push("No milestones yet. Call loop_plan with the sliced plan before building.");
        } else {
          lines.push(
            `${milestones.length} milestone(s) planned:`,
            ...milestones.map((milestone) => `  ${milestone.key}  ${milestone.name}`),
            "",
            "Next: run loop_preflight on the first milestone to check it is not already built.",
          );
        }

        return textResponse(lines.join("\n"));
      }),
  },

  {
    name: "loop_plan",
    title: "Set the milestone plan",
    description:
      "Replace the milestone plan of the active loop. Safe to call again to refine the plan: " +
      "milestones that already have recorded work keep their history, and the call is rejected " +
      "if it would discard a milestone that has iterations. Dependencies default to sequential " +
      "(each milestone waits for the previous one); pass dependsOn: [] to mark work independent. " +
      "Dependency cycles are rejected.",
    inputSchema: {
      milestones: z.array(MilestoneInputSchema).min(1).describe("The full ordered plan."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z.object({ milestones: z.array(MilestoneInputSchema).min(1) }).parse(args);
        const { milestones } = engine.plan(input.milestones);

        const withoutValidate = milestones.filter(
          (milestone) => milestone.validateCommand === undefined,
        );

        const lines = [
          `Plan set: ${milestones.length} milestone(s).`,
          ...milestones.map((milestone) => {
            const parts = [`  ${milestone.key}  ${milestone.name}`];

            if (milestone.dependsOn.length > 0) {
              parts.push(`      after: ${milestone.dependsOn.join(", ")}`);
            } else {
              parts.push("      after: nothing (can start immediately)");
            }

            if (milestone.validateCommand !== undefined) {
              parts.push(`      validate: ${milestone.validateCommand}`);
            }

            return parts.join("\n");
          }),
        ];

        if (withoutValidate.length > 0) {
          lines.push(
            "",
            `Warning: no validate command for ${withoutValidate
              .map((milestone) => milestone.key)
              .join(", ")}. ` +
              "Those milestones can only be proven by the project-wide gates.",
          );
        }

        return textResponse(lines.join("\n"));
      }),
  },

  {
    name: "loop_status",
    title: "Where am I",
    description:
      "Current loop state: goal, milestone list, which milestone is active, iteration count " +
      "against the cap, and whether the gates are currently green. Cheap — call it whenever unsure.",
    inputSchema: {},
    handler: (_args, engine) => guard(() => textResponse(formatStatus(engine.status()))),
  },

  {
    name: "loop_resume",
    title: "Cold-start catch-up",
    description:
      "Everything needed to continue in a fresh session with no prior context: the goal, what " +
      "shipped, what is in flight, the last gate failure, and recorded decisions. Call this first " +
      "in any new session on a project that has a loop.",
    inputSchema: {},
    handler: (_args, engine) => guard(() => textResponse(formatResume(engine.resume()))),
  },

  {
    name: "loop_preflight",
    title: "Is this already built?",
    description:
      "Run before writing code for a milestone. Searches recorded work for the symbols and nouns " +
      "you are about to create and returns UNBUILT, PARTIAL, or BUILT. A forgetful agent's default " +
      "is to build a second copy that drifts from the first — this is the guard against that.",
    inputSchema: {
      terms: z
        .array(z.string().min(1))
        .min(1)
        .describe("Symbols, routes, or nouns you intend to create, e.g. ['parseInvoice', '/login']."),
      milestoneKey: z.string().optional().describe("Defaults to the current milestone."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z
          .object({
            terms: z.array(z.string().min(1)).min(1),
            milestoneKey: z.string().optional(),
          })
          .parse(args);

        return textResponse(
          formatPreflight(
            engine.preflight({
              terms: input.terms,
              ...(input.milestoneKey !== undefined ? { milestoneKey: input.milestoneKey } : {}),
            }),
          ),
        );
      }),
  },

  {
    name: "loop_checkpoint",
    title: "Record one pass of work",
    description:
      "Record what you just did, before running gates. Refuses work on a milestone whose " +
      "prerequisites are unfinished — building on a dependency that is not done risks work that " +
      "has to be redone. Also enforces the iteration ceiling: once a milestone hits the cap the " +
      "loop stops instead of retrying forever. Include the next concrete step so a cold session " +
      "can pick up mid-flight.",
    inputSchema: {
      summary: z.string().min(1).describe("What you did this pass, in one or two sentences."),
      filesTouched: z.array(z.string()).optional().describe("Paths created or modified."),
      nextAction: z.string().optional().describe("The very next concrete step."),
      tokensUsed: z.number().int().nonnegative().optional().describe("Approximate tokens spent."),
      milestoneKey: z.string().optional().describe("Defaults to the current milestone."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z
          .object({
            summary: z.string().min(1),
            filesTouched: z.array(z.string()).optional(),
            nextAction: z.string().optional(),
            tokensUsed: z.number().int().nonnegative().optional(),
            milestoneKey: z.string().optional(),
          })
          .parse(args);

        const result = engine.checkpoint({
          summary: input.summary,
          ...(input.filesTouched !== undefined ? { filesTouched: input.filesTouched } : {}),
          ...(input.nextAction !== undefined ? { nextAction: input.nextAction } : {}),
          ...(input.tokensUsed !== undefined ? { tokensUsed: input.tokensUsed } : {}),
          ...(input.milestoneKey !== undefined ? { milestoneKey: input.milestoneKey } : {}),
        });

        const lines = [
          `Checkpoint recorded: ${result.milestone.key} iteration ${result.iteration.number}.`,
          `Iterations remaining: ${result.iterationsRemaining}.`,
        ];

        if (result.iterationsRemaining === 0) {
          lines.push(
            "",
            "This was the last permitted iteration. If the gates do not pass now, stop and " +
              "surface the problem to the human rather than retrying.",
          );
        }

        lines.push("", "Next: run loop_gate to prove the work.");

        return textResponse(lines.join("\n"));
      }),
  },

  {
    name: "loop_gate",
    title: "Run the gates",
    description:
      "Execute the project's configured gate commands and record the real exit codes. This is how " +
      "'it works' becomes a fact rather than a claim. On failure you get the raw compiler or test " +
      "output to fix. Gate commands come from stackforge.json — you cannot pass a command here.",
    inputSchema: {
      only: z
        .array(z.string().min(1))
        .optional()
        .describe("Subset of configured gate names, e.g. ['typecheck'] for a fast check."),
      milestoneKey: z.string().optional().describe("Defaults to the current milestone."),
    },
    handler: (args, engine) =>
      guard(async () => {
        const input = z
          .object({
            only: z.array(z.string().min(1)).optional(),
            milestoneKey: z.string().optional(),
          })
          .parse(args);

        const result = await engine.runGates({
          ...(input.only !== undefined ? { only: input.only } : {}),
          ...(input.milestoneKey !== undefined ? { milestoneKey: input.milestoneKey } : {}),
        });

        const response = formatGateResult(result);
        return result.passed ? textResponse(response) : errorResponse(response);
      }),
  },

  {
    name: "loop_validate",
    title: "Run the milestone's proof command",
    description:
      "Execute the milestone's own validateCommand — the demo command that proves the outcome, " +
      "distinct from the project-wide gates. Required before a milestone with a validateCommand " +
      "can be marked done.",
    inputSchema: {
      milestoneKey: z.string().optional().describe("Defaults to the current milestone."),
    },
    handler: (args, engine) =>
      guard(async () => {
        const input = z.object({ milestoneKey: z.string().optional() }).parse(args);

        const result = await engine.runValidate({
          ...(input.milestoneKey !== undefined ? { milestoneKey: input.milestoneKey } : {}),
        });

        const response = formatGateResult(result);
        return result.passed ? textResponse(response) : errorResponse(response);
      }),
  },

  {
    name: "loop_done",
    title: "Mark a milestone done",
    description:
      "Complete a milestone. Refused unless the evidence supports it: at least one recorded " +
      "iteration, every blocking gate green on its latest run, and the validateCommand green when " +
      "one is defined. There is no override — that is the point.",
    inputSchema: {
      summary: z
        .string()
        .optional()
        .describe(
          "What now exists, e.g. 'JWT login live at POST /login'. Stored as durable memory so " +
            "future pre-flights find it instead of rebuilding it.",
        ),
      milestoneKey: z.string().optional().describe("Defaults to the current milestone."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z
          .object({ summary: z.string().optional(), milestoneKey: z.string().optional() })
          .parse(args);

        const result = engine.markDone({
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.milestoneKey !== undefined ? { milestoneKey: input.milestoneKey } : {}),
        });

        const lines = [`✓ ${result.milestone.key} (${result.milestone.name}) is done.`];

        if (result.loopComplete) {
          lines.push(
            "",
            "Every milestone is complete — the loop is closed. Report the outcome to the human.",
          );
        } else if (result.nextMilestone !== undefined) {
          lines.push(
            "",
            `Next: ${result.nextMilestone.key} — ${result.nextMilestone.name}`,
            "Run loop_preflight before writing any code for it.",
          );
        }

        return textResponse(lines.join("\n"));
      }),
  },

  {
    name: "loop_skip",
    title: "Skip a milestone",
    description:
      "Skip a milestone that is no longer needed. Requires a reason, which is recorded as a " +
      "decision so a later session does not wonder why the work never happened.",
    inputSchema: {
      reason: z.string().min(1).describe("Why this milestone is being skipped."),
      milestoneKey: z.string().optional().describe("Defaults to the current milestone."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z
          .object({ reason: z.string().min(1), milestoneKey: z.string().optional() })
          .parse(args);

        const milestone = engine.skipMilestone({
          reason: input.reason,
          ...(input.milestoneKey !== undefined ? { milestoneKey: input.milestoneKey } : {}),
        });

        return textResponse(`Skipped ${milestone.key} (${milestone.name}). Reason recorded.`);
      }),
  },

  {
    name: "loop_remember",
    title: "Store a durable note",
    description:
      "Record something that must outlive this session: a decision and its rationale, a project " +
      "fact, a convention, a trap. Kind 'built' is special — loop_preflight searches it to prevent " +
      "rebuilding existing work.",
    inputSchema: {
      content: z.string().min(1).describe("The note itself, in one or two sentences."),
      kind: z
        .enum(MEMORY_KINDS)
        .optional()
        .describe(
          "decision (a choice that constrains future work) | fact (durable truth) | " +
            "pattern (reusable approach) | built (capability that now exists) | " +
            "gotcha (trap found the hard way). Defaults to fact.",
        ),
      tags: z.array(z.string()).optional().describe("Search tags."),
      pinned: z.boolean().optional().describe("Always surface this in recall."),
      milestoneKey: z.string().optional().describe("Associate with a specific milestone."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z
          .object({
            content: z.string().min(1),
            kind: z.enum(MEMORY_KINDS).optional(),
            tags: z.array(z.string()).optional(),
            pinned: z.boolean().optional(),
            milestoneKey: z.string().optional(),
          })
          .parse(args);

        const entry = engine.remember({
          content: input.content,
          ...(input.kind !== undefined ? { kind: input.kind as MemoryKind } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
          ...(input.milestoneKey !== undefined ? { milestoneKey: input.milestoneKey } : {}),
        });

        return textResponse(`Remembered as ${entry.kind} (id ${entry.id}).`);
      }),
  },

  {
    name: "loop_recall",
    title: "Search what is known",
    description:
      "Full-text search over recorded decisions, facts, patterns, built capabilities, and gotchas. " +
      "Use it before asking the human something they may have already answered, and before " +
      "designing something that may already have a convention.",
    inputSchema: {
      query: z.string().min(1).describe("Search terms."),
      kind: z.enum(MEMORY_KINDS).optional().describe("Restrict to one kind."),
      limit: z.number().int().positive().max(50).optional().describe("Max results (default 10)."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z
          .object({
            query: z.string().min(1),
            kind: z.enum(MEMORY_KINDS).optional(),
            limit: z.number().int().positive().max(50).optional(),
          })
          .parse(args);

        const hits = engine.recall(input.query, {
          ...(input.kind !== undefined ? { kind: input.kind as MemoryKind } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });

        return textResponse(formatMemories(hits));
      }),
  },

  {
    name: "loop_history",
    title: "Milestone history",
    description:
      "Full iteration log and gate-run history for a milestone. Use it to understand what has " +
      "already been tried before attempting another fix — repeating a failed approach costs an " +
      "iteration from the cap.",
    inputSchema: {
      milestoneKey: z.string().optional().describe("Defaults to the current milestone."),
    },
    handler: (args, engine) =>
      guard(() => {
        const input = z.object({ milestoneKey: z.string().optional() }).parse(args);
        const history = engine.history(input.milestoneKey);

        const gateLines =
          history.gateRuns.length === 0
            ? ["(no gate runs)"]
            : history.gateRuns
                .slice(0, 20)
                .map(
                  (run) =>
                    `  ${run.name}: ${run.passed ? "pass" : `FAIL(${run.exitCode})`} ` +
                    `at ${run.createdAt}`,
                );

        return textResponse(
          [
            `History for ${history.milestone.key} — ${history.milestone.name} ` +
              `[${history.milestone.status}]`,
            "",
            "─── iterations ───",
            formatIterations(history.iterations),
            "",
            "─── gate runs (newest first) ───",
            ...gateLines,
          ].join("\n"),
        );
      }),
  },

  {
    name: "loop_pause",
    title: "Pause the loop",
    description:
      "Pause the active loop, leaving all state intact. Use when handing control back to the human " +
      "mid-goal. A later session can resume from exactly this point.",
    inputSchema: {},
    handler: (_args, engine) =>
      guard(() => {
        const loop = engine.setLoopStatus(LOOP_STATUS.PAUSED);
        return textResponse(
          `Loop ${loop.id} paused. State preserved — call loop_resume to continue later.`,
        );
      }),
  },
];

/** Look a tool up by name. Used by the server and by tests. */
export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
