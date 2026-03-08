import crypto from "crypto";
import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { requireAuth, userRequiresTrustedDeviceProtection } from "../middleware/auth";
import { writeAudit } from "../services/audit";
import { validateBody } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";

const loginDeviceSchema = z
  .object({
    id: z.string().trim().min(16).max(200),
    label: z.string().trim().max(180).optional().nullable(),
    platform: z.string().trim().max(120).optional().nullable(),
    language: z.string().trim().max(40).optional().nullable(),
    timezone: z.string().trim().max(120).optional().nullable(),
    screen: z.string().trim().max(80).optional().nullable()
  })
  .strict();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  device: loginDeviceSchema.optional()
});

type LoginDevicePayload = z.infer<typeof loginDeviceSchema>;

type TrustedDeviceResolution =
  | { ok: true; trustedDeviceId: string | null }
  | { ok: false; status: number; message: string };

export const authRouter = Router();

function hashValue(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function normalizeOptionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function normalizeUserAgent(headerValue: unknown) {
  const userAgent = typeof headerValue === "string" ? headerValue.trim() : "";
  return userAgent.slice(0, 512) || null;
}

function buildFingerprintHash(device: LoginDevicePayload, userAgent: string | null) {
  const source = [
    device.id.trim(),
    normalizeOptionalText(device.platform) ?? "",
    normalizeOptionalText(device.language) ?? "",
    normalizeOptionalText(device.timezone) ?? "",
    normalizeOptionalText(device.screen) ?? "",
    userAgent ?? ""
  ].join("|");
  return hashValue(source);
}

async function resolveTrustedDeviceForLogin(params: {
  user: {
    id: string;
    role: Role;
    liveLocationEnabled: boolean;
  };
  device: LoginDevicePayload | undefined;
  userAgent: string | null;
}): Promise<TrustedDeviceResolution> {
  const { user, device, userAgent } = params;
  const requiresTrustedDevice = userRequiresTrustedDeviceProtection(user.role, user.liveLocationEnabled);

  if (!requiresTrustedDevice) {
    return { ok: true, trustedDeviceId: null };
  }

  if (!device) {
    return {
      ok: false,
      status: 400,
      message: "Trusted device verification is required. Please sign in from your registered device."
    };
  }

  const now = new Date();
  const persistentIdHash = hashValue(device.id.trim());
  const fingerprintHash = buildFingerprintHash(device, userAgent);
  const deviceLabel = normalizeOptionalText(device.label);
  const platform = normalizeOptionalText(device.platform);
  const browserLanguage = normalizeOptionalText(device.language);
  const timezone = normalizeOptionalText(device.timezone);
  const screen = normalizeOptionalText(device.screen);

  const existing = await prisma.userTrustedDevice.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      persistentIdHash: true,
      isActive: true
    }
  });

  if (!existing || !existing.isActive) {
    const trustedDevice = await prisma.userTrustedDevice.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        persistentIdHash,
        fingerprintHash,
        deviceLabel,
        userAgent,
        platform,
        browserLanguage,
        timezone,
        screen,
        firstTrustedAt: now,
        lastSeenAt: now,
        isActive: true,
        resetAt: null,
        resetByUserId: null
      },
      update: {
        persistentIdHash,
        fingerprintHash,
        deviceLabel,
        userAgent,
        platform,
        browserLanguage,
        timezone,
        screen,
        firstTrustedAt: now,
        lastSeenAt: now,
        isActive: true,
        resetAt: null,
        resetByUserId: null
      }
    });

    await writeAudit(user.id, "TRUSTED_DEVICE_ASSIGNED", "UserTrustedDevice", trustedDevice.id);
    return { ok: true, trustedDeviceId: trustedDevice.id };
  }

  if (existing.persistentIdHash !== persistentIdHash) {
    return {
      ok: false,
      status: 403,
      message: "This account is restricted to a trusted device. Please contact administrator."
    };
  }

  const trustedDevice = await prisma.userTrustedDevice.update({
    where: { id: existing.id },
    data: {
      fingerprintHash,
      deviceLabel,
      userAgent,
      platform,
      browserLanguage,
      timezone,
      screen,
      lastSeenAt: now,
      isActive: true
    },
    select: {
      id: true
    }
  });

  return { ok: true, trustedDeviceId: trustedDevice.id };
}

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { email: req.body.email } });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const trustedDeviceResult = await resolveTrustedDeviceForLogin({
      user: {
        id: user.id,
        role: user.role,
        liveLocationEnabled: user.liveLocationEnabled
      },
      device: req.body.device,
      userAgent: normalizeUserAgent(req.headers["user-agent"])
    });

    if (trustedDeviceResult.ok === false) {
      return res.status(trustedDeviceResult.status).json({ message: trustedDeviceResult.message });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        tdid: trustedDeviceResult.trustedDeviceId ?? undefined
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        liveLocationEnabled: user.liveLocationEnabled,
        liveLocationVisible: user.liveLocationVisible,
        trustedDeviceAssigned: Boolean(trustedDeviceResult.trustedDeviceId)
      }
    });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        liveLocationEnabled: true,
        liveLocationVisible: true,
        trustedDevice: {
          select: {
            isActive: true,
            lastSeenAt: true
          }
        }
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    return res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      liveLocationEnabled: user.liveLocationEnabled,
      liveLocationVisible: user.liveLocationVisible,
      trustedDeviceAssigned: Boolean(user.trustedDevice?.isActive),
      trustedDeviceLastSeenAt: user.trustedDevice?.lastSeenAt ?? null
    });
  })
);
