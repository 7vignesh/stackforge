import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { buildProjectZip } from "../services/fileWriter.js";

const DownloadRequestSchema = z.object({
  pipelineOutput: z.unknown(),
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const downloadRouter: IRouter = Router();

downloadRouter.post(
  "/download",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = DownloadRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(422).json({ error: "Invalid request body", issues: parsed.error.issues });
      return;
    }

    const { pipelineOutput } = parsed.data;
    if (!isObject(pipelineOutput)) {
      res.status(422).json({ error: "pipelineOutput must be a JSON object" });
      return;
    }

    try {
      const { projectName, buffer } = await buildProjectZip(pipelineOutput);
      const fileName = `stackforge-${projectName}.zip`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.status(200).send(buffer);
    } catch (error) {
      next(error);
    }
  },
);

export { downloadRouter };
