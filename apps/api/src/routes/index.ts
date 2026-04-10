import { Router, type IRouter } from "express";
import { generateController } from "../controllers/generate.controller.js";
import {
	runtimeController,
	listJobsController,
	getJobController,
	streamController,
} from "../controllers/jobs.controller.js";
import { downloadRouter } from "./download.js";

const router: IRouter = Router();

router.post("/generate", generateController);
router.get("/runtime", runtimeController);
router.get("/jobs", listJobsController);
router.get("/jobs/:jobId", getJobController);
router.get("/stream/:jobId", streamController);
router.use(downloadRouter);

export { router };
