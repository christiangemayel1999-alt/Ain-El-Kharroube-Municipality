import { DispatchStatus, Role } from "@prisma/client";
import { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody, validateQuery } from "../middleware/validate";
import { updateDispatchStatus } from "../services/incidentResponse";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";

const dispatchQuerySchema = z.object({
  incidentId: z.string().uuid().optional(),
  status: z.nativeEnum(DispatchStatus).optional()
});

const dispatchActionSchema = z.object({
  notes: z.string().trim().max(1500).optional().nullable()
});

export const dispatchesRouter = Router();

dispatchesRouter.get(
  "/",
  validateQuery(dispatchQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as z.infer<typeof dispatchQuerySchema>;
    const where =
      req.user!.role === Role.POLICE
        ? {
            incidentId: q.incidentId,
            status: q.status,
            OR: [{ officerId: req.user!.id }, { officerId: null }]
          }
        : {
            incidentId: q.incidentId,
            status: q.status
          };

    const dispatches = await prisma.incidentDispatch.findMany({
      where,
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
        unit: true,
        officer: { select: { id: true, fullName: true, email: true, role: true } }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });

    return res.json(dispatches);
  })
);

dispatchesRouter.get(
  "/mine",
  requireRoles(Role.POLICE),
  asyncHandler(async (req, res) => {
    const dispatches = await prisma.incidentDispatch.findMany({
      where: {
        OR: [{ officerId: req.user!.id }, { officerId: null }]
      },
      include: {
        incident: {
          include: {
            vehicle: true,
            emergencyPlan: {
              include: {
                steps: { orderBy: { stepOrder: "asc" } }
              }
            }
          }
        },
        unit: true,
        officer: { select: { id: true, fullName: true, email: true, role: true } }
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }]
    });

    return res.json(dispatches);
  })
);

async function handleDispatchAction(
  req: Request,
  res: Response,
  action: "ACKNOWLEDGE" | "EN_ROUTE" | "ARRIVED" | "COMPLETE"
) {
  const payload = req.body as z.infer<typeof dispatchActionSchema>;
  let result;
  try {
    result = await updateDispatchStatus({
      dispatchId: req.params.id,
      action,
      actorId: req.user!.id,
      actorRole: req.user!.role,
      notes: payload.notes
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update dispatch";
    if (message === "Dispatch not found") {
      return res.status(404).json({ message });
    }
    if (message === "Dispatch is assigned to another officer") {
      return res.status(403).json({ message });
    }
    throw error;
  }

  await writeAudit(req.user!.id, action, "IncidentDispatch", req.params.id);
  return res.json(result);
}

dispatchesRouter.post(
  "/:id/acknowledge",
  requireRoles(Role.POLICE, Role.ADMIN, Role.CASE_WORKER),
  validateBody(dispatchActionSchema),
  asyncHandler(async (req, res) => handleDispatchAction(req, res, "ACKNOWLEDGE"))
);

dispatchesRouter.post(
  "/:id/en-route",
  requireRoles(Role.POLICE, Role.ADMIN, Role.CASE_WORKER),
  validateBody(dispatchActionSchema),
  asyncHandler(async (req, res) => handleDispatchAction(req, res, "EN_ROUTE"))
);

dispatchesRouter.post(
  "/:id/arrived",
  requireRoles(Role.POLICE, Role.ADMIN, Role.CASE_WORKER),
  validateBody(dispatchActionSchema),
  asyncHandler(async (req, res) => handleDispatchAction(req, res, "ARRIVED"))
);

dispatchesRouter.post(
  "/:id/complete",
  requireRoles(Role.POLICE, Role.ADMIN, Role.CASE_WORKER),
  validateBody(dispatchActionSchema),
  asyncHandler(async (req, res) => handleDispatchAction(req, res, "COMPLETE"))
);
