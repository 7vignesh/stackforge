import { z } from "zod";
import { AgentNameSchema } from "./job.schema.js";

const SSEBaseSchema = z.object({
  jobId: z.string().uuid(),
  timestamp: z.string().datetime(),
});

export const JobCreatedEventSchema = SSEBaseSchema.extend({
  type: z.literal("job_created"),
  payload: z.object({
    prompt: z.string(),
    projectName: z.string(),
  }),
});

export const AgentStartedEventSchema = SSEBaseSchema.extend({
  type: z.literal("agent_started"),
  agent: AgentNameSchema,
  payload: z.object({}),
});

export const AgentCompletedEventSchema = SSEBaseSchema.extend({
  type: z.literal("agent_completed"),
  agent: AgentNameSchema,
  payload: z.object({
    durationMs: z.number(),
    cached: z.boolean(),
  }),
});

export const AgentFailedEventSchema = SSEBaseSchema.extend({
  type: z.literal("agent_failed"),
  agent: AgentNameSchema,
  payload: z.object({
    error: z.string(),
  }),
});

export const JobCompletedEventSchema = SSEBaseSchema.extend({
  type: z.literal("job_completed"),
  payload: z.object({
    durationMs: z.number(),
  }),
});

export const JobFailedEventSchema = SSEBaseSchema.extend({
  type: z.literal("job_failed"),
  payload: z.object({
    error: z.string(),
  }),
});

export const SSEEventSchema = z.discriminatedUnion("type", [
  JobCreatedEventSchema,
  AgentStartedEventSchema,
  AgentCompletedEventSchema,
  AgentFailedEventSchema,
  JobCompletedEventSchema,
  JobFailedEventSchema,
]);

export type SSEEvent = z.infer<typeof SSEEventSchema>;
export type JobCreatedEvent = z.infer<typeof JobCreatedEventSchema>;
export type AgentStartedEvent = z.infer<typeof AgentStartedEventSchema>;
export type AgentCompletedEvent = z.infer<typeof AgentCompletedEventSchema>;
export type AgentFailedEvent = z.infer<typeof AgentFailedEventSchema>;
export type JobCompletedEvent = z.infer<typeof JobCompletedEventSchema>;
export type JobFailedEvent = z.infer<typeof JobFailedEventSchema>;
