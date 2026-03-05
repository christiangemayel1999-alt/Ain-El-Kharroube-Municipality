import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateQuery } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";

const carsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  model: z.string().trim().max(60).optional(),
  color: z.string().trim().max(40).optional(),
  safetyCheckStatus: z.enum(["PENDING", "CHECKED_SAFE"]).optional()
});

export const carsRouter = Router();

carsRouter.get(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER, Role.VIEWER, Role.POLICE, Role.FINANCE),
  validateQuery(carsQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof carsQuerySchema>;
    const search = query.q?.trim();

    const rows = await prisma.household.findMany({
      where: {
        hasCar: true,
        carModel: query.model ? { contains: query.model, mode: "insensitive" } : undefined,
        carColor: query.color ? { contains: query.color, mode: "insensitive" } : undefined,
        safetyCheckStatus: query.safetyCheckStatus,
        OR: search
          ? [
              { householdCode: { contains: search, mode: "insensitive" } },
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { headName: { contains: search, mode: "insensitive" } },
              { civilIdentityNumber: { contains: search, mode: "insensitive" } },
              { carPlate: { contains: search, mode: "insensitive" } },
              { carModel: { contains: search, mode: "insensitive" } },
              { carColor: { contains: search, mode: "insensitive" } }
            ]
          : undefined
      },
      include: {
        zone: true
      },
      orderBy: [{ carPlate: "asc" }, { createdAt: "desc" }]
    });

    return res.json(
      rows.map((row) => ({
        householdId: row.id,
        householdCode: row.householdCode,
        firstName: row.firstName,
        lastName: row.lastName,
        fatherName: row.fatherName,
        motherName: row.motherName,
        headName: row.headName,
        civilIdentityNumber: row.civilIdentityNumber,
        phoneNumber: row.phoneNumber,
        originArea: row.originArea,
        safetyCheckStatus: row.safetyCheckStatus,
        casePriority: row.casePriority,
        carModel: row.carModel,
        carColor: row.carColor,
        carPlate: row.carPlate,
        zone: row.zone,
        createdAt: row.createdAt
      }))
    );
  })
);
