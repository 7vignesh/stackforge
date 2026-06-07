import "dotenv/config";
import express, { type Express, type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { router } from "./routes/index.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { generalLimiter } from "./middleware/rate-limit.middleware.js";

const app: Express = express();
const PORT = process.env["PORT"] ?? "3001";
const IS_PRODUCTION = process.env["NODE_ENV"] === "production";

// Security headers — includes HSTS for HTTPS enforcement in production
app.use(
  helmet({
    hsts: IS_PRODUCTION
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  }),
);

// HTTPS redirect in production (behind reverse proxy with X-Forwarded-Proto)
if (IS_PRODUCTION) {
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    if (req.protocol !== "https" && req.get("X-Forwarded-Proto") !== "https") {
      res.redirect(301, `https://${req.get("host") ?? "localhost"}${req.originalUrl}`);
      return;
    }
    next();
  });
}

// Body parser with size limits to prevent payload abuse
app.use(express.json({ limit: "2mb" }));

// CORS — restrict to known origins
const ALLOWED_ORIGINS = (process.env["CORS_ALLOWED_ORIGINS"] ?? "http://localhost:5173,http://localhost:3001")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "stackforge-api", ts: new Date().toISOString() });
});

// Apply general rate limiter to all API routes
app.use("/api", generalLimiter, router);

app.use(errorMiddleware as ErrorRequestHandler);

app.listen(Number(PORT), () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
  console.log(`  POST /api/generate`);
  console.log(`  GET  /api/jobs/:jobId`);
  console.log(`  GET  /api/stream/:jobId`);
});

export { app };
