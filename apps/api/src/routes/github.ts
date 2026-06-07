import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { pushToGitHub, type GithubPushProgress } from "../services/githubPusher.js";
import { githubPushLimiter } from "../middleware/rate-limit.middleware.js";

/**
 * GitHub token format validation.
 * Accepts: ghp_*, gho_*, github_pat_*, ghu_*, ghs_*, ghr_* prefixes.
 */
const GITHUB_TOKEN_REGEX = /^(ghp_|gho_|github_pat_|ghu_|ghs_|ghr_)[a-zA-Z0-9_]+$/;

const GithubPushRequestSchema = z.object({
  pipelineOutput: z.unknown(),
  projectName: z.string().min(1).max(100),
  githubToken: z
    .string()
    .min(1)
    .refine(
      (token) => GITHUB_TOKEN_REGEX.test(token),
      { message: "Invalid GitHub token format. Use a valid personal access token." },
    ),
});

/**
 * Redact a token for safe logging (show only prefix and last 4 chars).
 */
function redactToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeEvent(
  res: Response,
  event: { type: "progress" | "result" | "error"; message?: string; repoUrl?: string; success?: boolean; filePath?: string },
): void {
  res.write(`${JSON.stringify(event)}\n`);
}

const githubRouter: IRouter = Router();

githubRouter.post("/github/push", githubPushLimiter, async (req: Request, res: Response): Promise<void> => {
  const parsed = GithubPushRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(422).json({ error: "Invalid request body", issues: parsed.error.issues });
    return;
  }

  const { pipelineOutput, projectName, githubToken } = parsed.data;
  if (!isObject(pipelineOutput)) {
    res.status(422).json({ error: "pipelineOutput must be a JSON object" });
    return;
  }

  // Log the push attempt with redacted token for audit trail
  console.log(`[github-push] Initiating push for project "${projectName}" with token ${redactToken(githubToken)}`);

  const acceptHeader = req.headers["accept"];
  const wantsStream = typeof acceptHeader === "string" && acceptHeader.includes("application/x-ndjson");

  if (!wantsStream) {
    try {
      const result = await pushToGitHub(pipelineOutput, projectName, githubToken);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to push to GitHub";
      // Never include the token in error responses
      const safeMessage = message.replace(githubToken, "[REDACTED]");
      res.status(500).json({ error: safeMessage });
    }
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform, no-store");
  res.setHeader("Connection", "keep-alive");

  try {
    const result = await pushToGitHub(
      pipelineOutput,
      projectName,
      githubToken,
      async (progress: GithubPushProgress): Promise<void> => {
        writeEvent(res, {
          type: "progress",
          message: progress.message,
          ...(progress.filePath ? { filePath: progress.filePath } : {}),
          ...(progress.repoUrl ? { repoUrl: progress.repoUrl } : {}),
        });
      },
    );

    writeEvent(res, {
      type: "result",
      repoUrl: result.repoUrl,
      success: result.success,
    });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to push to GitHub";
    const safeMessage = message.replace(githubToken, "[REDACTED]");
    writeEvent(res, {
      type: "error",
      message: safeMessage,
      success: false,
    });
    res.end();
  }
});

export { githubRouter };
