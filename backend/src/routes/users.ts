import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  isActive: z.boolean().optional().default(true),
  liveLocationEnabled: z.boolean().optional().default(false),
  liveLocationVisible: z.boolean().optional().default(false)
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(2).optional(),
  password: z.string().min(8).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  liveLocationEnabled: z.boolean().optional(),
  liveLocationVisible: z.boolean().optional()
});

const userSelect = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  liveLocationEnabled: true,
  liveLocationVisible: true,
  createdAt: true,
  updatedAt: true,
  trustedDevice: {
    select: {
      id: true,
      isActive: true,
      deviceLabel: true,
      platform: true,
      browserLanguage: true,
      timezone: true,
      firstTrustedAt: true,
      lastSeenAt: true,
      resetAt: true
    }
  }
} as const;

export const usersRouter = Router();

usersRouter.use(requireRoles(Role.ADMIN));

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: userSelect
    });
    return res.json(users);
  })
);

usersRouter.post(
  "/",
  validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.user.create({
      data: {
        email: req.body.email,
        fullName: req.body.fullName,
        role: req.body.role,
        isActive: req.body.isActive,
        liveLocationEnabled: req.body.liveLocationEnabled,
        liveLocationVisible: req.body.liveLocationVisible,
        passwordHash
      },
      select: userSelect
    });

    await writeAudit(req.user!.id, "CREATE", "User", user.id);
    return res.status(201).json(user);
  })
);

usersRouter.patch(
  "/:id",
  validateBody(updateUserSchema),
  asyncHandler(async (req, res) => {
    const data: Record<string, unknown> = { ...req.body };
    const userId = z.string().uuid().parse(req.params.id);
    if (req.body.password) {
      data.passwordHash = await bcrypt.hash(req.body.password, 10);
      delete data.password;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: userSelect
    });

    if (req.body.liveLocationEnabled === false) {
      const now = new Date();
      await prisma.locationSharingSession.updateMany({
        where: {
          userId,
          isActive: true
        },
        data: {
          isActive: false,
          stoppedAt: now,
          stoppedReason: "LIVE_TRACKING_DISABLED"
        }
      });

      await prisma.liveLocationState.upsert({
        where: { userId },
        create: {
          userId,
          isSharing: false
        },
        update: {
          isSharing: false
        }
      });
    }

    await writeAudit(req.user!.id, "UPDATE", "User", user.id);
    return res.json(user);
  })
);

usersRouter.post(
  "/:id/trusted-device/reset",
  asyncHandler(async (req, res) => {
    const userId = z.string().uuid().parse(req.params.id);
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!existingUser) {
      return res.status(404).json({ message: "User not found." });
    }

    const now = new Date();
    const trustedDevice = await prisma.userTrustedDevice.findUnique({
      where: { userId },
      select: { id: true, isActive: true }
    });

    if (trustedDevice?.isActive) {
      await prisma.userTrustedDevice.update({
        where: { id: trustedDevice.id },
        data: {
          isActive: false,
          resetAt: now,
          resetByUserId: req.user!.id
        }
      });
    }

    await prisma.locationSharingSession.updateMany({
      where: {
        userId,
        isActive: true
      },
      data: {
        isActive: false,
        stoppedAt: now,
        stoppedReason: "TRUSTED_DEVICE_RESET"
      }
    });

    await prisma.liveLocationState.upsert({
      where: { userId },
      create: {
        userId,
        isSharing: false
      },
      update: {
        isSharing: false
      }
    });

    await writeAudit(req.user!.id, "RESET_TRUSTED_DEVICE", "User", userId);
    return res.json({
      userId,
      resetAt: now,
      hadTrustedDevice: Boolean(trustedDevice?.isActive)
    });
  })
);

usersRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.user.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "User", req.params.id);
    return res.status(204).send();
  })
);

