import { Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";

const policePostSchema = z.object({
  label: z.string().trim().min(2).max(120),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  officersCount: z.coerce.number().int().min(1).max(300).default(1),
  notes: z.string().trim().max(300).optional().nullable()
});

const emergencyPlanSchemaBase = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().default(true),
  policePosts: z.array(policePostSchema).default([])
});

const createEmergencyPlanSchema = emergencyPlanSchemaBase
  .superRefine((data, ctx) => {
    if (!data.policePosts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add at least one police post"
      });
    }
  });

const updateEmergencyPlanSchema = emergencyPlanSchemaBase.partial();

export const emergencyPlansRouter = Router();

type ActivationPlan = {
  id: string;
  name: string;
  policePosts: Array<{
    label: string;
    lat: number;
    lng: number;
  }>;
};

async function notifyPoliceForPlanActivation(tx: Prisma.TransactionClient, plan: ActivationPlan) {
  const policeUsers = await tx.user.findMany({
    where: {
      role: Role.POLICE,
      isActive: true
    },
    select: { id: true }
  });

  if (!policeUsers.length) {
    return;
  }

  const posts = plan.policePosts;
  const notifications = policeUsers.map((user, index) => {
    const assigned = posts.length ? posts[index % posts.length] : null;
    const message = assigned
      ? `Emergency plan "${plan.name}" is active. Report to ${assigned.label} at (${assigned.lat.toFixed(5)}, ${assigned.lng.toFixed(5)}).`
      : `Emergency plan "${plan.name}" is active. Report to command center for assignment.`;

    return {
      userId: user.id,
      title: `Emergency Plan Activated: ${plan.name}`,
      message,
      emergencyPlanId: plan.id,
      policePostLabel: assigned?.label ?? null,
      targetLat: assigned?.lat ?? null,
      targetLng: assigned?.lng ?? null
    };
  });

  await tx.notification.createMany({ data: notifications });
}

emergencyPlansRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const plans = await prisma.emergencyPlan.findMany({
      include: {
        policePosts: true,
        createdBy: {
          select: { id: true, fullName: true, email: true }
        }
      },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }]
    });

    return res.json(plans);
  })
);

emergencyPlansRouter.get(
  "/active",
  asyncHandler(async (_req, res) => {
    const activePlan = await prisma.emergencyPlan.findFirst({
      where: { isActive: true },
      include: {
        policePosts: true,
        createdBy: { select: { id: true, fullName: true, email: true } }
      },
      orderBy: { updatedAt: "desc" }
    });

    return res.json(activePlan);
  })
);

emergencyPlansRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(createEmergencyPlanSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createEmergencyPlanSchema>;

    const created = await prisma.$transaction(async (tx) => {
      if (payload.isActive) {
        await tx.emergencyPlan.updateMany({
          where: { isActive: true },
          data: { isActive: false }
        });
      }

      const plan = await tx.emergencyPlan.create({
        data: {
          name: payload.name,
          description: payload.description ?? null,
          isActive: payload.isActive,
          createdByUserId: req.user!.id,
          policePosts: {
            create: payload.policePosts.map((post) => ({
              label: post.label,
              lat: post.lat,
              lng: post.lng,
              officersCount: post.officersCount,
              notes: post.notes ?? null
            }))
          }
        },
        include: {
          policePosts: true
        }
      });

      if (plan.isActive) {
        await notifyPoliceForPlanActivation(tx, {
          id: plan.id,
          name: plan.name,
          policePosts: plan.policePosts.map((post) => ({
            label: post.label,
            lat: post.lat,
            lng: post.lng
          }))
        });
      }

      return plan;
    });

    await writeAudit(req.user!.id, "CREATE", "EmergencyPlan", created.id);
    return res.status(201).json(created);
  })
);

emergencyPlansRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(updateEmergencyPlanSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof updateEmergencyPlanSchema>;
    if (payload.policePosts && payload.policePosts.length === 0) {
      return res.status(400).json({ message: "At least one police post is required" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.emergencyPlan.findUnique({
        where: { id: req.params.id },
        select: { isActive: true }
      });

      if (!existing) {
        return null;
      }

      const activatedNow = payload.isActive === true && existing.isActive === false;
      if (payload.isActive) {
        await tx.emergencyPlan.updateMany({
          where: { isActive: true, id: { not: req.params.id } },
          data: { isActive: false }
        });
      }

      await tx.emergencyPlan.update({
        where: { id: req.params.id },
        data: {
          name: payload.name,
          description: payload.description,
          isActive: payload.isActive
        }
      });

      if (payload.policePosts) {
        await tx.emergencyPolicePost.deleteMany({
          where: { planId: req.params.id }
        });
        if (payload.policePosts.length) {
          await tx.emergencyPolicePost.createMany({
            data: payload.policePosts.map((post) => ({
              planId: req.params.id,
              label: post.label,
              lat: post.lat,
              lng: post.lng,
              officersCount: post.officersCount,
              notes: post.notes ?? null
            }))
          });
        }
      }

      const plan = await tx.emergencyPlan.findUnique({
        where: { id: req.params.id },
        include: {
          policePosts: true,
          createdBy: { select: { id: true, fullName: true, email: true } }
        }
      });

      if (plan && activatedNow) {
        await notifyPoliceForPlanActivation(tx, {
          id: plan.id,
          name: plan.name,
          policePosts: plan.policePosts.map((post) => ({
            label: post.label,
            lat: post.lat,
            lng: post.lng
          }))
        });
      }

      return plan;
    });

    if (!updated) {
      return res.status(404).json({ message: "Emergency plan not found" });
    }

    await writeAudit(req.user!.id, "UPDATE", "EmergencyPlan", req.params.id);
    return res.json(updated);
  })
);

emergencyPlansRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.emergencyPlan.delete({
      where: { id: req.params.id }
    });
    await writeAudit(req.user!.id, "DELETE", "EmergencyPlan", req.params.id);
    return res.status(204).send();
  })
);
