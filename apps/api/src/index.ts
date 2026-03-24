// apps/api — Express entry point (skeleton, populated in Phase 4)
import express from "express";

const app = express();
const PORT = process.env["PORT"] ?? 3001;

app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "stackforge-api" });
});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});

export { app };
