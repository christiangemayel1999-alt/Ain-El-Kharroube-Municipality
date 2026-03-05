import { Prisma } from "@prisma/client";
import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ message: "Not found" });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({ message: "Validation failed", issues: error.flatten() });
  }

  if (
    error instanceof SyntaxError &&
    typeof (error as { status?: unknown }).status === "number" &&
    (error as { status?: number }).status === 400
  ) {
    return res.status(400).json({ message: "Malformed JSON" });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : "field";
      return res.status(409).json({ message: `Duplicate value for unique ${target}` });
    }
    if (error.code === "P2025") {
      return res.status(404).json({ message: "Record not found" });
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({ message: "Invalid data payload for database operation" });
  }

  if (error instanceof Error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }

  return res.status(500).json({ message: "Internal server error" });
}

