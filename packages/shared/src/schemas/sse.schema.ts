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
    inputTokens: z.number(),
    outputTokens: z.number(),
    totalTokens: z.number(),
    tokensUsed: z.number(),
    estimatedInputTokens: z.number(),
    compressionPasses: z.number(),
    providerInputTokens: z.number(),
    providerOutputTokens: z.number(),
    model: z.string(),
  }),
});

export const AgentFailedEventSchema = SSEBaseSchema.extend({
  type: z.literal("agent_failed"),
  agent: AgentNameSchema,
  payload: z.object({
    error: z.string(),
  }),
});

export const AgentTokenEventSchema = z.object({
  type: z.literal("agent_token"),
  jobId: z.string().uuid(),
  agentId: AgentNameSchema,
  token: z.string(),
  timestamp: z.number(),
});

export const AgentCompleteEventSchema = z.object({
  type: z.literal("agent_complete"),
  jobId: z.string().uuid(),
  agentId: AgentNameSchema,
  fullOutput: z.unknown(),
  timestamp: z.number(),
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

const TelemetrySchema = z.object({
  runId: z.string().uuid(),
  startTime: z.number(),
  endTime: z.number().nullable(),
  elapsedTimeMs: z.number(),
  agentsTotal: z.number(),
  agentsCompleted: z.number(),
  totalTokensUsed: z.number(),
  tokensByAgent: z.record(z.string(), z.number()),
  providerBreakdown: z.record(
    z.string(),
    z.object({ calls: z.number(), tokens: z.number() }),
  ),
  modelBreakdown: z.record(
    z.string(),
    z.object({ calls: z.number(), tokens: z.number() }),
  ),
  estimatedCostINR: z.number(),
});

export const TelemetryUpdateEventSchema = SSEBaseSchema.extend({
  type: z.literal("telemetry_update"),
  data: TelemetrySchema,
});

export const SSEEventSchema = z.discriminatedUnion("type", [
  JobCreatedEventSchema,
  AgentStartedEventSchema,
  AgentTokenEventSchema,
  AgentCompleteEventSchema,
  AgentCompletedEventSchema,
  AgentFailedEventSchema,
  JobCompletedEventSchema,
  JobFailedEventSchema,
  TelemetryUpdateEventSchema,
]);

export type SSEEvent = z.infer<typeof SSEEventSchema>;
export type JobCreatedEvent = z.infer<typeof JobCreatedEventSchema>;
export type AgentStartedEvent = z.infer<typeof AgentStartedEventSchema>;
export type AgentTokenEvent = z.infer<typeof AgentTokenEventSchema>;
export type AgentCompleteEvent = z.infer<typeof AgentCompleteEventSchema>;
export type AgentCompletedEvent = z.infer<typeof AgentCompletedEventSchema>;
export type AgentFailedEvent = z.infer<typeof AgentFailedEventSchema>;
export type JobCompletedEvent = z.infer<typeof JobCompletedEventSchema>;
export type JobFailedEvent = z.infer<typeof JobFailedEventSchema>;
export type TelemetryUpdateEvent = z.infer<typeof TelemetryUpdateEventSchema>;
export type Telemetry = z.infer<typeof TelemetrySchema>;
