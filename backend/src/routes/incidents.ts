import { IncidentPriority, IncidentStatus, IncidentType, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";
import { createWithCodeRetry } from "../utils/code";

const incidentSchema = z.object({
  householdId: z.string().uuid().optional().nullable(),
  type: z.nativeEnum(IncidentType),
  priority: z.nativeEnum(IncidentPriority),
  description: z.string().min(3),
  assignedUserId: z.string().uuid().optional().nullable(),
  status: z.nativeEnum(IncidentStatus),
  dueDate: z.string().optional().nullable(),
  resolutionNotes: z.string().optional().nullable()
});

const incidentPatchSchema = incidentSchema.partial();

export const incidentsRouter = Router();

incidentsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const incidents = await prisma.incident.findMany({
      include: {
        household: { select: { id: true, householdCode: true } },
        assignedUser: { select: { id: true, fullName: true, email: true, role: true } }
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }]
    });
    return res.json(incidents);
  })
);

incidentsRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(incidentSchema),
  asyncHandler(async (req, res) => {
    const incident = await createWithCodeRetry({
      model: "incident",
      create: async (incidentCode) =>
        prisma.incident.create({
          data: {
            incidentCode,
            householdId: req.body.householdId ?? null,
            type: req.body.type,
            priority: req.body.priority,
            description: req.body.description,
            assignedUserId: req.body.assignedUserId ?? null,
            status: req.body.status,
            dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
            resolutionNotes: req.body.resolutionNotes ?? null
          }
        })
    });

    await writeAudit(req.user!.id, "CREATE", "Incident", incident.id);
    return res.status(201).json(incident);
  })
);

incidentsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const incident = await prisma.incident.findUnique({ where: { id: req.params.id } });
    if (!incident) {
      return res.status(404).json({ message: "Incident not found" });
    }
    return res.json(incident);
  })
);

incidentsRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(incidentPatchSchema),
  asyncHandler(async (req, res) => {
    const data: Record<string, unknown> = {
      ...req.body,
      dueDate: req.body.dueDate === undefined ? undefined : req.body.dueDate ? new Date(req.body.dueDate) : null
    };

    const incident = await prisma.incident.update({ where: { id: req.params.id }, data });
    await writeAudit(req.user!.id, "UPDATE", "Incident", incident.id);
    return res.json(incident);
  })
);

incidentsRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.incident.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "Incident", req.params.id);
    return res.status(204).send();
  })
);

