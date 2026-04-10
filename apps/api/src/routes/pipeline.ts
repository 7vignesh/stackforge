import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { addFeatureToBlueprint } from "../services/addFeature.service.js";
import { getProviderForPipeline, getRuntimeStatus } from "../services/generate.service.js";

const AddFeatureRequestSchema = z.object({
  runId: z.string().uuid(),
  previousOutput: z.record(z.string(), z.unknown()),
  featureRequest: z.string().min(3),
});

const pipelineRouter: IRouter = Router();

pipelineRouter.post(
  "/pipeline/add-feature",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = AddFeatureRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(422).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const runtime = getRuntimeStatus();
    if (!runtime.ready) {
      res.status(503).json({ error: runtime.reason ?? "Runtime not ready", provider: runtime.provider });
      return;
    }

    try {
      const result = await addFeatureToBlueprint({
        ...parsed.data,
        provider: getProviderForPipeline(),
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export { pipelineRouter };
