import { z } from "zod";
import { AgentNameSchema } from "./job.schema.js";

export const BudgetEnforcementSchema = z.enum(["strict", "warn"]);

export const TokenBudgetSchema = z.object({
  maxTotalTokens: z.number().int().min(500).max(100000).optional(),
  perAgent: z.record(AgentNameSchema, z.number().int().min(100).max(20000)).optional(),
  enforcement: BudgetEnforcementSchema.optional(),
});

export const GenerateExecutionSchema = z.object({
  enableCodeGeneration: z.boolean().optional(),
  tokenBudget: TokenBudgetSchema.optional(),
});

export const GenerateRequestSchema = z.object({
  prompt: z.string().min(10).max(2000),
  projectName: z.string().min(1).max(100).optional(),
  execution: GenerateExecutionSchema.optional(),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type BudgetEnforcement = z.infer<typeof BudgetEnforcementSchema>;
export type TokenBudget = z.infer<typeof TokenBudgetSchema>;
export type GenerateExecution = z.infer<typeof GenerateExecutionSchema>;

export const JobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

export type JobIdParam = z.infer<typeof JobIdParamSchema>;
