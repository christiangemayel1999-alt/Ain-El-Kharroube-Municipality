import {
  EmergencyPlanType,
  EmergencySeverity,
  Prisma,
  Role,
  UnitType
} from "@prisma/client";
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

const planStepSchema = z.object({
  stepOrder: z.coerce.number().int().min(1),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(1000).optional().nullable(),
  icon: z.string().trim().max(24).optional().nullable(),
  unitTypeRequired: z.nativeEnum(UnitType).default(UnitType.POLICE),
  isRequired: z.boolean().default(true)
});

const emergencyPlanSchemaBase = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.nativeEnum(EmergencyPlanType).default(EmergencyPlanType.CUSTOM),
  severity: z.nativeEnum(EmergencySeverity).default(EmergencySeverity.MEDIUM),
  description: z.string().trim().max(1000).optional().nullable(),
  defaultNotificationTitle: z.string().trim().max(180).optional().nullable(),
  defaultNotificationMessage: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().default(false),
  policePosts: z.array(policePostSchema).default([]),
  steps: z.array(planStepSchema).default([])
});

const createEmergencyPlanSchema = emergencyPlanSchemaBase;

const updateEmergencyPlanSchema = emergencyPlanSchemaBase.partial();

export const emergencyPlansRouter = Router();

type ActivationPlan = {
  id: string;
  name: string;
  defaultNotificationTitle: string | null;
  defaultNotificationMessage: string | null;
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
    const title = plan.defaultNotificationTitle?.trim() || `Emergency Plan Activated: ${plan.name}`;
    const fallbackMessage = assigned
      ? `Plan "${plan.name}" is active. Report to ${assigned.label} at (${assigned.lat.toFixed(5)}, ${assigned.lng.toFixed(5)}).`
      : `Plan "${plan.name}" is active. Report to command center for assignment.`;

    return {
      userId: user.id,
      title,
      message: plan.defaultNotificationMessage?.trim() || fallbackMessage,
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
        steps: { orderBy: { stepOrder: "asc" } },
        policePosts: { orderBy: { createdAt: "asc" } },
        createdBy: {
          select: { id: true, fullName: true, email: true }
        }
      },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
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
        steps: { orderBy: { stepOrder: "asc" } },
        policePosts: { orderBy: { createdAt: "asc" } },
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

      const incomingSteps =
        payload.steps.length > 0
          ? payload.steps
          : [
              {
                stepOrder: 1,
                title: "Initial field response",
                description: "Nearest unit acknowledges and proceeds to location.",
                icon: "ALERT",
                unitTypeRequired: UnitType.POLICE,
                isRequired: true
              }
            ];
      const orderedSteps = incomingSteps
        .slice()
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map((step, index) => ({
          ...step,
          stepOrder: index + 1
        }));

      const plan = await tx.emergencyPlan.create({
        data: {
          name: payload.name,
          type: payload.type,
          severity: payload.severity,
          description: payload.description ?? null,
          defaultNotificationTitle: payload.defaultNotificationTitle ?? null,
          defaultNotificationMessage: payload.defaultNotificationMessage ?? null,
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
          },
          steps: {
            create: orderedSteps.map((step) => ({
              stepOrder: step.stepOrder,
              title: step.title,
              description: step.description ?? null,
              icon: step.icon ?? null,
              unitTypeRequired: step.unitTypeRequired,
              isRequired: step.isRequired
            }))
          }
        },
        include: {
          steps: { orderBy: { stepOrder: "asc" } },
          policePosts: true
        }
      });

      if (plan.isActive) {
        await notifyPoliceForPlanActivation(tx, {
          id: plan.id,
          name: plan.name,
          defaultNotificationTitle: plan.defaultNotificationTitle,
          defaultNotificationMessage: plan.defaultNotificationMessage,
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

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.emergencyPlan.findUnique({
        where: { id: req.params.id },
        select: { id: true, isActive: true }
      });
      if (!existing) {
        return null;
      }

      if (payload.isActive === true) {
        await tx.emergencyPlan.updateMany({
          where: { isActive: true, id: { not: req.params.id } },
          data: { isActive: false }
        });
      }

      await tx.emergencyPlan.update({
        where: { id: req.params.id },
        data: {
          name: payload.name,
          type: payload.type,
          severity: payload.severity,
          description: payload.description,
          defaultNotificationTitle: payload.defaultNotificationTitle,
          defaultNotificationMessage: payload.defaultNotificationMessage,
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

      if (payload.steps) {
        await tx.emergencyPlanStep.deleteMany({
          where: { planId: req.params.id }
        });
        const incomingSteps =
          payload.steps.length > 0
            ? payload.steps
            : [
                {
                  stepOrder: 1,
                  title: "Initial field response",
                  description: "Nearest unit acknowledges and proceeds to location.",
                  icon: "ALERT",
                  unitTypeRequired: UnitType.POLICE,
                  isRequired: true
                }
              ];
        if (incomingSteps.length) {
          const orderedSteps = incomingSteps
            .slice()
            .sort((a, b) => a.stepOrder - b.stepOrder)
            .map((step, index) => ({
              ...step,
              stepOrder: index + 1
            }));
          await tx.emergencyPlanStep.createMany({
            data: orderedSteps.map((step) => ({
              planId: req.params.id,
              stepOrder: step.stepOrder,
              title: step.title,
              description: step.description ?? null,
              icon: step.icon ?? null,
              unitTypeRequired: step.unitTypeRequired,
              isRequired: step.isRequired
            }))
          });
        }
      }

      const plan = await tx.emergencyPlan.findUnique({
        where: { id: req.params.id },
        include: {
          steps: { orderBy: { stepOrder: "asc" } },
          policePosts: true,
          createdBy: { select: { id: true, fullName: true, email: true } }
        }
      });

      if (plan && payload.isActive === true && existing.isActive === false) {
        await notifyPoliceForPlanActivation(tx, {
          id: plan.id,
          name: plan.name,
          defaultNotificationTitle: plan.defaultNotificationTitle,
          defaultNotificationMessage: plan.defaultNotificationMessage,
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
