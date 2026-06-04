import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { buildProjectZip } from "../services/fileWriter.js";

const DownloadRequestSchema = z.object({
  pipelineOutput: z.unknown(),
});

/**
 * Maximum allowed ZIP buffer size (10 MB).
 * Prevents abuse through crafted payloads that produce enormous output.
 */
const MAX_ZIP_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Maximum number of files allowed in a generated project.
 */
const MAX_FILE_COUNT = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sanitize filename for Content-Disposition header.
 * Removes any characters that could cause header injection.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "stackforge-project";
}

/**
 * Estimate total content size from pipeline output to reject oversized payloads early.
 */
function estimateContentSize(pipelineOutput: Record<string, unknown>): number {
  const json = JSON.stringify(pipelineOutput);
  return json.length;
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

    // Early rejection of oversized payloads (rough estimate: 5MB of JSON input)
    const estimatedSize = estimateContentSize(pipelineOutput);
    if (estimatedSize > 5 * 1024 * 1024) {
      res.status(413).json({ error: "Pipeline output is too large to process." });
      return;
    }

    try {
      const { projectName, buffer } = await buildProjectZip(pipelineOutput, {
        maxFiles: MAX_FILE_COUNT,
      });

      if (buffer.length > MAX_ZIP_SIZE_BYTES) {
        res.status(413).json({ error: "Generated ZIP exceeds maximum allowed size." });
        return;
      }

      const safeName = sanitizeFilename(projectName);
      const fileName = `stackforge-${safeName}.zip`;

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
