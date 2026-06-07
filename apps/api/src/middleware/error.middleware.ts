import type { Request, Response, NextFunction } from "express";

const IS_PRODUCTION = process.env["NODE_ENV"] === "production";

/**
 * Known operational errors that are safe to surface to clients.
 */
const SAFE_ERROR_PATTERNS = [
  /validation failed/i,
  /invalid.*blueprint/i,
  /token budget/i,
  /provider.*not configured/i,
];

function isSafeToExpose(message: string): boolean {
  return SAFE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const rawMessage = err instanceof Error ? err.message : "internal server error";
  const stack = err instanceof Error ? err.stack : undefined;

  // Always log full error details server-side
  console.error("[api:error]", {
    message: rawMessage,
    ...(stack ? { stack } : {}),
    requestId: _req.headers["x-request-id"] ?? "unknown",
    timestamp: new Date().toISOString(),
  });

  // In production, only expose safe/known error messages
  const clientMessage = IS_PRODUCTION && !isSafeToExpose(rawMessage)
    ? "An internal error occurred. Please try again later."
    : rawMessage;

  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;

  res.status(statusCode).json({
    error: clientMessage,
    ...(IS_PRODUCTION ? {} : { detail: rawMessage }),
  });
}
