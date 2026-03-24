import "dotenv/config";
import express, { type Express, type ErrorRequestHandler } from "express";
import { router } from "./routes/index.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

const app: Express = express();
const PORT = process.env["PORT"] ?? "3001";

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "stackforge-api", ts: new Date().toISOString() });
});

app.use("/api", router);

app.use(errorMiddleware as ErrorRequestHandler);

app.listen(Number(PORT), () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  console.log(`  POST /api/generate`);
  console.log(`  GET  /api/jobs/:jobId`);
  console.log(`  GET  /api/stream/:jobId`);
});

export { app };
