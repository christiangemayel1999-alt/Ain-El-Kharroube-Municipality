import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateQuery } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";

export const notificationsRouter = Router();

const notificationQuerySchema = z.object({
  unreadOnly: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

notificationsRouter.get(
  "/me",
  requireRoles(Role.POLICE, Role.ADMIN, Role.CASE_WORKER),
  validateQuery(notificationQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof notificationQuerySchema>;
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user!.id,
        isRead: q.unreadOnly ? false : undefined
      },
      include: {
        incident: {
          select: {
            id: true,
            incidentCode: true,
            title: true,
            type: true,
            priority: true,
            severity: true,
            status: true,
            locationLabel: true,
            locationLat: true,
            locationLng: true
          }
        },
        dispatch: {
          select: {
            id: true,
            status: true,
            unit: { select: { id: true, name: true, type: true } }
          }
        }
      },
      orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
      take: 100
    });
    return res.json(notifications);
  })
);

notificationsRouter.patch(
  "/:id/read",
  requireRoles(Role.POLICE, Role.ADMIN, Role.CASE_WORKER),
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
