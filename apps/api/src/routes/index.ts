import { Router, type IRouter } from "express";
import express from "express";
import { generateController } from "../controllers/generate.controller.js";
import {
	runtimeController,
	listJobsController,
	getJobController,
	streamController,
} from "../controllers/jobs.controller.js";
import { downloadRouter } from "./download.js";
import { githubRouter } from "./github.js";
import { pipelineRouter } from "./pipeline.js";
import { generateLimiter } from "../middleware/rate-limit.middleware.js";

const router: IRouter = Router();

// Generate endpoint — small payload only (prompts + config)
router.post("/generate", express.json({ limit: "64kb" }), generateLimiter, generateController);
router.get("/runtime", runtimeController);
router.get("/jobs", listJobsController);
router.get("/jobs/:jobId", getJobController);
router.get("/stream/:jobId", streamController);
router.use(downloadRouter);
router.use(githubRouter);
router.use(pipelineRouter);

export { router };
