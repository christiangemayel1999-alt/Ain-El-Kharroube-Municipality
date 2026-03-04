import { RentalAgreementStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";
import { createWithCodeRetry } from "../utils/code";

const agreementSchema = z.object({
  householdId: z.string().uuid(),
  housingUnitId: z.string().uuid(),
  landlordId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  monthlyRent: z.coerce.number().positive(),
  deposit: z.coerce.number().nonnegative().optional().nullable(),
  status: z.nativeEnum(RentalAgreementStatus),
  notes: z.string().optional().nullable()
});

const agreementPatchSchema = agreementSchema.partial();

export const rentalAgreementsRouter = Router();

rentalAgreementsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const agreements = await prisma.rentalAgreement.findMany({
      include: {
        household: true,
        housingUnit: true,
        landlord: true
      },
      orderBy: { createdAt: "desc" }
    });
    return res.json(agreements);
  })
);

rentalAgreementsRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(agreementSchema),
  asyncHandler(async (req, res) => {
    const agreement = await createWithCodeRetry({
      model: "agreement",
      create: async (agreementCode) =>
        prisma.rentalAgreement.create({
          data: {
            agreementCode,
            householdId: req.body.householdId,
            housingUnitId: req.body.housingUnitId,
            landlordId: req.body.landlordId,
            startDate: new Date(req.body.startDate),
            endDate: req.body.endDate ? new Date(req.body.endDate) : null,
            monthlyRent: req.body.monthlyRent,
            deposit: req.body.deposit ?? null,
            status: req.body.status,
            notes: req.body.notes ?? null
          }
        })
    });
    await writeAudit(req.user!.id, "CREATE", "RentalAgreement", agreement.id);
    return res.status(201).json(agreement);
  })
);

rentalAgreementsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const agreement = await prisma.rentalAgreement.findUnique({
      where: { id: req.params.id },
      include: { household: true, housingUnit: true, landlord: true }
    });

    if (!agreement) {
      return res.status(404).json({ message: "Rental agreement not found" });
    }

    return res.json(agreement);
  })
);

rentalAgreementsRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(agreementPatchSchema),
  asyncHandler(async (req, res) => {
    const data: Record<string, unknown> = {
      ...req.body,
      endDate: req.body.endDate === undefined ? undefined : req.body.endDate ? new Date(req.body.endDate) : null,
      startDate: req.body.startDate ? new Date(req.body.startDate) : undefined
    };

    const agreement = await prisma.rentalAgreement.update({ where: { id: req.params.id }, data });
    await writeAudit(req.user!.id, "UPDATE", "RentalAgreement", agreement.id);
    return res.json(agreement);
  })
);

rentalAgreementsRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.rentalAgreement.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "RentalAgreement", req.params.id);
    return res.status(204).send();
  })
);

