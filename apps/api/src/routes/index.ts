import { Router, type IRouter } from "express";
import { generateController } from "../controllers/generate.controller.js";
import { getJobController, streamController } from "../controllers/jobs.controller.js";

const router: IRouter = Router();

router.post("/generate", generateController);
router.get("/jobs/:jobId", getJobController);
router.get("/stream/:jobId", streamController);

export { router };
