import type { Request, Response, NextFunction } from "express";

/**
 * Simple API key authentication middleware.
 *
 * When STACKFORGE_API_KEY is set in the environment, all protected routes
 * require a matching Authorization header: `Bearer <key>` or `X-API-Key: <key>`.
 *
 * When STACKFORGE_API_KEY is NOT set (local dev), auth is bypassed.
 */

const API_KEY = (process.env["STACKFORGE_API_KEY"] ?? "").trim();
const AUTH_ENABLED = API_KEY.length > 0;

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string") {
    return apiKeyHeader.trim();
  }

  return undefined;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED) {
    next();
    return;
  }

  const token = extractToken(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required. Provide API key via Authorization header or X-API-Key header." });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(token, API_KEY)) {
    res.status(403).json({ error: "Invalid API key." });
    return;
  }

  next();
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid short-circuit timing leak on length
    let dummy = 0;
    for (let i = 0; i < a.length; i++) {
      dummy |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    void dummy;
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
