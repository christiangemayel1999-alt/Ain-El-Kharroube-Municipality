import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";

interface JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  tdid?: string;
}

export function userRequiresTrustedDeviceProtection(role: Role, liveLocationEnabled: boolean) {
  // Browser fingerprints are not hardware identity proof; this is operational trust control.
  return liveLocationEnabled || role !== Role.VIEWER;
}

export function extractBearerToken(authorizationHeader: string | string[] | undefined) {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice(7).trim();
  return token.length ? token : null;
}

export async function authenticateBearerToken(token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (!payload.sub) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        liveLocationEnabled: true,
        trustedDevice: {
          select: {
            id: true,
            isActive: true
          }
        }
      }
    });

    if (!user || !user.isActive) {
      return null;
    }

    if (userRequiresTrustedDeviceProtection(user.role, user.liveLocationEnabled)) {
      if (!payload.tdid || !user.trustedDevice || !user.trustedDevice.isActive || user.trustedDevice.id !== payload.tdid) {
        return null;
      }
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      trustedDeviceId: user.trustedDevice?.id ?? null
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await authenticateBearerToken(token);
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  req.user = user;
  return next();
}

