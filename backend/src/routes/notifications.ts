import { Role } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { asyncHandler } from "../utils/asyncHandler";

export const notificationsRouter = Router();

notificationsRouter.get(
  "/me",
  requireRoles(Role.POLICE),
  asyncHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take: 100
    });
    return res.json(notifications);
  })
);

notificationsRouter.patch(
  "/:id/read",
  requireRoles(Role.POLICE),
  asyncHandler(async (req, res) => {
    const existing = await prisma.notification.findUnique({
      where: { id: req.params.id }
    });

    if (!existing || existing.userId !== req.user!.id) {
      return res.status(404).json({ message: "Notification not found" });
    }

    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data: {
        isRead: true,
        readAt: new Date()
      }
    });
    return res.json(updated);
  })
);
