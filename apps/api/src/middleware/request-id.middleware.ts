import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Request ID middleware.
 *
 * Assigns a unique X-Request-Id header to every request for tracing and
 * log correlation. If the client provides one, it is reused (useful when
 * behind a reverse proxy that generates request IDs).
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId = req.headers["x-request-id"];
  const requestId = typeof existingId === "string" && existingId.trim().length > 0
    ? existingId.trim().slice(0, 64) // Cap length to prevent header abuse
    : randomUUID();

  // Make it available to downstream handlers
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-Id", requestId);

  next();
}
