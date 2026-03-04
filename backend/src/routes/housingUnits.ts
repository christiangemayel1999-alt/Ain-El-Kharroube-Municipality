import { HousingUnitStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";
import { createWithCodeRetry } from "../utils/code";

const unitSchema = z.object({
  zoneId: z.string().uuid(),
  streetLabel: z.string().optional().nullable(),
  type: z.string().min(2),
  rooms: z.coerce.number().int().min(0),
  capacity: z.coerce.number().int().min(1),
  utilities: z.record(z.any()).default({}),
  condition: z.string().min(2),
  status: z.nativeEnum(HousingUnitStatus),
  notes: z.string().optional().nullable()
});

const unitPatchSchema = unitSchema.partial();

export const housingUnitsRouter = Router();

housingUnitsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const units = await prisma.housingUnit.findMany({
      include: { zone: true },
      orderBy: { createdAt: "desc" }
    });
    return res.json(units);
  })
);

housingUnitsRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(unitSchema),
  asyncHandler(async (req, res) => {
    const unit = await createWithCodeRetry({
      model: "unit",
      create: async (unitCode) =>
        prisma.housingUnit.create({
          data: {
            unitCode,
            ...req.body,
            streetLabel: req.body.streetLabel ?? null,
            notes: req.body.notes ?? null
          }
        })
    });
    await writeAudit(req.user!.id, "CREATE", "HousingUnit", unit.id);
    return res.status(201).json(unit);
  })
);

housingUnitsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const unit = await prisma.housingUnit.findUnique({ where: { id: req.params.id }, include: { zone: true } });
    if (!unit) {
      return res.status(404).json({ message: "Housing unit not found" });
    }
    return res.json(unit);
  })
);

housingUnitsRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(unitPatchSchema),
  asyncHandler(async (req, res) => {
    const unit = await prisma.housingUnit.update({
      where: { id: req.params.id },
      data: req.body
    });
    await writeAudit(req.user!.id, "UPDATE", "HousingUnit", unit.id);
    return res.json(unit);
  })
);

housingUnitsRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.housingUnit.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "HousingUnit", req.params.id);
    return res.status(204).send();
  })
);

