import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/errors.js";

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    const message = err.issues[0]?.message || "Invalid request payload";
    return res.status(400).json({
      message,
      errors: err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const status = err instanceof ApiError ? err.status : 500;
  const message = err.message || "Internal Server Error";
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ message });
}
