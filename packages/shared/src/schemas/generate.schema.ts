import { z } from "zod";

export const GenerateRequestSchema = z.object({
  prompt: z.string().min(10).max(2000),
  projectName: z.string().min(1).max(100).optional(),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const JobIdParamSchema = z.object({
  jobId: z.string().uuid(),
});

export type JobIdParam = z.infer<typeof JobIdParamSchema>;
