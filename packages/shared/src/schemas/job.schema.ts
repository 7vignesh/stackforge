import { z } from "zod";
import { AGENT_NAMES } from "../constants/agents.js";
import { JOB_STATUS } from "../constants/job-status.js";

export const AgentNameSchema = z.enum(
  AGENT_NAMES as unknown as [string, ...string[]],
);

export const JobStatusSchema = z.enum([
  JOB_STATUS.QUEUED,
  JOB_STATUS.RUNNING,
  JOB_STATUS.COMPLETED,
  JOB_STATUS.FAILED,
]);

export const JobSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string(),
  projectName: z.string(),
  status: JobStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
  agentsCompleted: z.array(AgentNameSchema),
  blueprint: z.unknown().optional(),
});

export type Job = z.infer<typeof JobSchema>;
