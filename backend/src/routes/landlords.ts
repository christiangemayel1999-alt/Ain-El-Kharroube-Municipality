import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";
import { canViewRestrictedContact, maskPhone } from "../utils/serialize";

const landlordSchema = z.object({
  name: z.string().min(2),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
});

const landlordPatchSchema = landlordSchema.partial();

function sanitizeLandlord<T extends { phone: string | null }>(landlord: T, role: Role): T {
  if (canViewRestrictedContact(role)) {
    return landlord;
  }
  return { ...landlord, phone: maskPhone(landlord.phone) };
}

export const landlordsRouter = Router();

landlordsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const landlords = await prisma.landlord.findMany({ orderBy: { createdAt: "desc" } });
    return res.json(landlords.map((landlord) => sanitizeLandlord(landlord, req.user!.role)));
  })
);

landlordsRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(landlordSchema),
  asyncHandler(async (req, res) => {
    const landlord = await prisma.landlord.create({
      data: {
        name: req.body.name,
        phone: req.body.phone ?? null,
        notes: req.body.notes ?? null
      }
    });
    await writeAudit(req.user!.id, "CREATE", "Landlord", landlord.id);
    return res.status(201).json(landlord);
  })
);

landlordsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const landlord = await prisma.landlord.findUnique({ where: { id: req.params.id } });
    if (!landlord) {
      return res.status(404).json({ message: "Landlord not found" });
    }
    return res.json(sanitizeLandlord(landlord, req.user!.role));
  })
);

landlordsRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(landlordPatchSchema),
  asyncHandler(async (req, res) => {
    const landlord = await prisma.landlord.update({ where: { id: req.params.id }, data: req.body });
    await writeAudit(req.user!.id, "UPDATE", "Landlord", landlord.id);
    return res.json(landlord);
  })
);

landlordsRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.landlord.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "Landlord", req.params.id);
    return res.status(204).send();
  })
);

