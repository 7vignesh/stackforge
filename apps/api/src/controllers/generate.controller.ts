import type { Request, Response, NextFunction } from "express";
import { GenerateRequestSchema } from "@stackforge/shared";
import { generateProject, getRuntimeStatus } from "../services/generate.service.js";

export function generateController(req: Request, res: Response, next: NextFunction): void {
  const parsed = GenerateRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(422).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { prompt, projectName } = parsed.data;
  const resolvedName = projectName ?? prompt.slice(0, 40).replace(/\s+/g, "-").toLowerCase();
  const runtime = getRuntimeStatus();

  if (!runtime.ready) {
    res.status(503).json({
      error: runtime.reason ?? "LLM provider is not configured",
      provider: runtime.provider,
    });
    return;
  }

  try {
    const job = generateProject(prompt, resolvedName);
    res.status(202).json({
      jobId: job.id,
      status: job.status,
      projectName: job.projectName,
      createdAt: job.createdAt,
      streamUrl: `/api/stream/${job.id}`,
      jobUrl: `/api/jobs/${job.id}`,
    });
  } catch (err) {
    next(err);
  }
}
