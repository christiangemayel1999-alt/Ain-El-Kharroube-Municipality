import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";

const zoneSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(2).max(100)
});

const zonePatchSchema = zoneSchema.partial();

export const zonesRouter = Router();

zonesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const zones = await prisma.zone.findMany({ orderBy: { name: "asc" } });
    return res.json(zones);
  })
);

zonesRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(zoneSchema),
  asyncHandler(async (req, res) => {
    const zone = await prisma.zone.create({ data: req.body });
    await writeAudit(req.user!.id, "CREATE", "Zone", zone.id);
    return res.status(201).json(zone);
  })
);

zonesRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(zonePatchSchema),
  asyncHandler(async (req, res) => {
    const zone = await prisma.zone.update({ where: { id: req.params.id }, data: req.body });
    await writeAudit(req.user!.id, "UPDATE", "Zone", zone.id);
    return res.json(zone);
  })
);

zonesRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.zone.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "Zone", req.params.id);
    return res.status(204).send();
  })
);

