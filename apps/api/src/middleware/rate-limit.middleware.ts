import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";

/**
 * General API rate limiter — 100 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
}) as unknown as RequestHandler;

/**
 * Stricter rate limiter for generation endpoints — 10 requests per 15 minutes per IP.
 * These consume LLM API credits and are expensive.
 */
export const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Generation rate limit exceeded. Please wait before trying again." },
}) as unknown as RequestHandler;

/**
 * Rate limiter for GitHub push — 5 requests per 15 minutes per IP.
 */
export const githubPushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "GitHub push rate limit exceeded. Please wait before trying again." },
}) as unknown as RequestHandler;
