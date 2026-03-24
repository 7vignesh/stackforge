import type { Request, Response, NextFunction } from "express";
import { JobIdParamSchema, JOB_STATUS } from "@stackforge/shared";
import { getJob } from "../store/job.store.js";
import { subscribe, unsubscribe } from "../services/sse.service.js";

export function getJobController(req: Request, res: Response, next: NextFunction): void {
  const parsed = JobIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid jobId — must be a UUID" });
    return;
  }

  const job = getJob(parsed.data.jobId);
  if (job === undefined) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json({
    id: job.id,
    status: job.status,
    projectName: job.projectName,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    agentsCompleted: job.agentsCompleted,
    error: job.error,
    blueprint: job.blueprint,
  });
}

export function streamController(req: Request, res: Response, next: NextFunction): void {
  const parsed = JobIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid jobId — must be a UUID" });
    return;
  }

  const job = getJob(parsed.data.jobId);
  if (job === undefined) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const isDone =
    job.status === JOB_STATUS.COMPLETED || job.status === JOB_STATUS.FAILED;

  // Replay past events + register for live events
  subscribe(job.id, res, job.events);

  // If already finished, close immediately after replay
  if (isDone) {
    unsubscribe(job.id, res);
    res.end();
    return;
  }

  // Clean up on client disconnect
  req.on("close", () => unsubscribe(job.id, res));
}
