import type { Request, Response, NextFunction } from "express";

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error("[api:error]", err);
  const message = err instanceof Error ? err.message : "internal server error";
  res.status(500).json({ error: message });
}
