import { Role, UnitStatus, UnitType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";

const responseUnitSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.nativeEnum(UnitType),
  status: z.nativeEnum(UnitStatus).default(UnitStatus.AVAILABLE),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  assignedOfficerId: z.string().uuid().optional().nullable()
});

const responseUnitPatchSchema = responseUnitSchema.partial();

export const responseUnitsRouter = Router();

responseUnitsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const units = await prisma.responseUnit.findMany({
      include: {
        assignedOfficer: {
          select: { id: true, fullName: true, email: true, role: true, isActive: true }
        }
      },
      orderBy: [{ status: "asc" }, { type: "asc" }, { name: "asc" }]
    });
    return res.json(units);
  })
);

responseUnitsRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(responseUnitSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof responseUnitSchema>;
    const unit = await prisma.responseUnit.create({
      data: {
        name: payload.name,
        type: payload.type,
        status: payload.status,
        latitude: payload.latitude ?? null,
        longitude: payload.longitude ?? null,
        assignedOfficerId: payload.assignedOfficerId ?? null
      },
      include: {
        assignedOfficer: {
          select: { id: true, fullName: true, email: true, role: true, isActive: true }
        }
      }
    });
    await writeAudit(req.user!.id, "CREATE", "ResponseUnit", unit.id);
    return res.status(201).json(unit);
  })
);

responseUnitsRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(responseUnitPatchSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof responseUnitPatchSchema>;
    const unit = await prisma.responseUnit.update({
      where: { id: req.params.id },
      data: {
        name: payload.name,
        type: payload.type,
        status: payload.status,
        latitude: payload.latitude === undefined ? undefined : payload.latitude,
        longitude: payload.longitude === undefined ? undefined : payload.longitude,
        assignedOfficerId:
          payload.assignedOfficerId === undefined ? undefined : payload.assignedOfficerId
      },
      include: {
        assignedOfficer: {
          select: { id: true, fullName: true, email: true, role: true, isActive: true }
        }
      }
    });
    await writeAudit(req.user!.id, "UPDATE", "ResponseUnit", unit.id);
    return res.json(unit);
  })
);

responseUnitsRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.responseUnit.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "ResponseUnit", req.params.id);
    return res.status(204).send();
  })
);
