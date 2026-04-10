import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { pushToGitHub, type GithubPushProgress } from "../services/githubPusher.js";

const GithubPushRequestSchema = z.object({
  pipelineOutput: z.unknown(),
  projectName: z.string().min(1),
  githubToken: z.string().min(1),
});

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

githubRouter.post("/github/push", async (req: Request, res: Response): Promise<void> => {
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

  const acceptHeader = req.headers["accept"];
  const wantsStream = typeof acceptHeader === "string" && acceptHeader.includes("application/x-ndjson");

  if (!wantsStream) {
    try {
      const result = await pushToGitHub(pipelineOutput, projectName, githubToken);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to push to GitHub";
      res.status(500).json({ error: message });
    }
    return;
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
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
    writeEvent(res, {
      type: "error",
      message,
      success: false,
    });
    res.end();
  }
});

export { githubRouter };
