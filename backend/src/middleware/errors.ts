import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (response.headersSent) return;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (code === "23505") {
    response.status(409).json({ error: "A record with these details already exists" });
    return;
  }
  if (code === "23503" || code === "23514" || code === "22P02") {
    response.status(400).json({ error: "Request conflicts with database rules" });
    return;
  }
  response.status(500).json({
    error: "Internal server error",
    ...(env.isProduction ? {} : { detail: error instanceof Error ? error.message : "Unknown error" })
  });
}
