import { CasePriority, FamilyCheckStatus, HousingType, HouseholdStatus, Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { validateBody, validateQuery } from "../middleware/validate";
import { writeAudit } from "../services/audit";
import { asyncHandler } from "../utils/asyncHandler";
import { createWithCodeRetry } from "../utils/code";
import { sectionFromCoordinates } from "../utils/sectioning";
import { snapToGrid } from "../utils/snapToGrid";

const householdMemberSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    age: z.coerce.number().int().min(0).max(120),
    gender: z.enum(["MALE", "FEMALE"]),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    fatherName: z.string().trim().min(1).max(80),
    motherName: z.string().trim().min(1).max(80),
    civilIdentityNumber: z.string().trim().min(3).max(40),
    phoneNumber: z.string().trim().min(7).max(40),
    originArea: z.string().trim().min(1).max(160),
    nationality: z.string().trim().min(1).max(60),
    relationshipToHead: z.string().trim().max(50).optional().nullable(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    yearOfBirth: z.coerce.number().int().min(1900).max(2100).optional().nullable(),
    idDocStatus: z.enum(["HAS_ID", "NO_ID", "UNKNOWN"]).default("UNKNOWN"),
    idDocType: z.string().trim().max(30).optional().nullable(),
    idDocLast4: z.string().regex(/^\d{4}$/).optional().nullable(),
    hasDisability: z.boolean().default(false),
    hasChronicCondition: z.boolean().default(false),
    pregnantOrLactating: z.boolean().default(false),
    schoolEnrollment: z.enum(["ENROLLED", "NOT_ENROLLED", "NA"]).default("NA"),
    employmentStatus: z.enum(["EMPLOYED", "UNEMPLOYED", "NA"]).default("NA"),
    hasCar: z.boolean().default(false),
    carModel: z.string().trim().max(60).optional().nullable(),
    carColor: z.string().trim().max(40).optional().nullable(),
    carPlate: z.string().trim().max(30).optional().nullable()
  })
  .superRefine((data, ctx) => {
    if (data.idDocStatus === "HAS_ID" && (!data.idDocType || !data.idDocLast4)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "idDocType and idDocLast4 are required when idDocStatus is HAS_ID"
      });
    }

    if (data.hasCar && (!data.carModel || !data.carColor || !data.carPlate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "carModel, carColor and carPlate are required when member hasCar is true"
      });
    }
  });

const householdSchemaBase = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  fatherName: z.string().trim().min(1).max(80),
  motherName: z.string().trim().min(1).max(80),
  civilIdentityNumber: z.string().trim().min(3).max(40),
  phoneNumber: z.string().trim().min(7).max(40),
  pinLabel: z.string().trim().min(1).max(120).optional().nullable(),
  headName: z.string().optional().nullable(),
  arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "arrivalDate must be in YYYY-MM-DD format"),
  originArea: z.string().optional().nullable(),
  zoneId: z.string().uuid().optional().nullable(),
  housingType: z.nativeEnum(HousingType),
  familySize: z.coerce.number().int().min(1),
  status: z.nativeEnum(HouseholdStatus).default(HouseholdStatus.ACTIVE),
  age0_4: z.coerce.number().int().min(0).default(0),
  age5_17: z.coerce.number().int().min(0).default(0),
  age18_59: z.coerce.number().int().min(0).default(0),
  age60plus: z.coerce.number().int().min(0).default(0),
  vulnerabilityFlags: z.array(z.string()).default([]),
  needs: z.array(z.string()).default([]),
  notes: z.string().optional().nullable(),
  members: z.array(householdMemberSchema).max(30).default([]),
  safetyCheckStatus: z.nativeEnum(FamilyCheckStatus).default(FamilyCheckStatus.PENDING),
  casePriority: z.nativeEnum(CasePriority).default(CasePriority.MEDIUM),
  nationality: z.string().trim().max(60).optional().nullable(),
  preferredLanguage: z.string().trim().max(60).optional().nullable(),
  emergencyName: z.string().trim().max(120).optional().nullable(),
  emergencyPhone: z.string().trim().max(40).optional().nullable(),
  emergencyRelation: z.string().trim().max(40).optional().nullable(),
  hasCar: z.boolean().default(false),
  carModel: z.string().max(60).optional().nullable(),
  carColor: z.string().max(40).optional().nullable(),
  carPlate: z.string().max(30).optional().nullable(),
  pinPrecisionM: z.coerce.number().int().min(0).max(5000).default(0),
  isVerified: z.boolean().optional().default(false),
  clickedLat: z.number().min(-90).max(90).optional(),
  clickedLng: z.number().min(-180).max(180).optional()
});

const householdSchema = householdSchemaBase.superRefine((data, ctx) => {
  if (data.hasCar && (!data.carModel || !data.carColor || !data.carPlate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "carModel, carColor and carPlate are required when hasCar is true"
    });
  }
  if (!data.zoneId && (data.clickedLat === undefined || data.clickedLng === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either zoneId or coordinates are required"
    });
  }
});

const householdPatchSchema = householdSchemaBase.partial().superRefine((data, ctx) => {
  if (data.hasCar === true && (!data.carModel || !data.carColor || !data.carPlate)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "carModel, carColor and carPlate are required when hasCar is true"
    });
  }
});

const householdQuerySchema = z.object({
  zoneId: z.string().uuid().optional(),
  status: z.nativeEnum(HouseholdStatus).optional(),
  safetyCheckStatus: z.nativeEnum(FamilyCheckStatus).optional(),
  casePriority: z.nativeEnum(CasePriority).optional(),
  needs: z.string().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional()
});

const contactSchema = z.object({
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  consent: z.boolean().optional().default(false)
});

type HouseholdMemberInput = z.infer<typeof householdMemberSchema>;
type HouseholdPayload = z.infer<typeof householdSchema>;

function summarizeMembers(members: HouseholdMemberInput[]) {
  if (!members.length) {
    return null;
  }

  const summary = {
    familySize: members.length,
    age0_4: 0,
    age5_17: 0,
    age18_59: 0,
    age60plus: 0
  };

  for (const member of members) {
    if (member.age <= 4) {
      summary.age0_4 += 1;
      continue;
    }
    if (member.age <= 17) {
      summary.age5_17 += 1;
      continue;
    }
    if (member.age <= 59) {
      summary.age18_59 += 1;
      continue;
    }
    summary.age60plus += 1;
  }

  return summary;
}

function resolvePin(lat: number, lng: number, pinPrecisionM: number) {
  if (pinPrecisionM > 0) {
    return snapToGrid(lat, lng, pinPrecisionM);
  }

  return {
    approxLat: Number(lat.toFixed(6)),
    approxLng: Number(lng.toFixed(6)),
    pinPrecisionM: 0
  };
}

export const householdsRouter = Router();

householdsRouter.get(
  "/",
  validateQuery(householdQuerySchema),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof householdQuerySchema>;

    const households = await prisma.household.findMany({
      where: {
        zoneId: q.zoneId,
        status: q.status,
        safetyCheckStatus: q.safetyCheckStatus,
        casePriority: q.casePriority,
        needs: q.needs ? { array_contains: [q.needs] } : undefined,
        incidents: q.priority ? { some: { priority: q.priority } } : undefined
      },
      include: {
        zone: true,
        rentalAgreements: true,
        incidents: true
      },
      orderBy: { createdAt: "desc" }
    });

    return res.json(households);
  })
);

householdsRouter.post(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(householdSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as HouseholdPayload;
    const memberSummary = summarizeMembers(payload.members);
    const normalizedHeadName =
      (payload.headName ? payload.headName.trim() : `${payload.firstName} ${payload.lastName}`.trim()) || null;

    let resolvedZoneId = payload.zoneId ?? null;
    const snapped =
      payload.clickedLat !== undefined && payload.clickedLng !== undefined
        ? resolvePin(payload.clickedLat, payload.clickedLng, payload.pinPrecisionM)
        : null;

    if (payload.clickedLat !== undefined && payload.clickedLng !== undefined) {
      const section = sectionFromCoordinates(payload.clickedLat, payload.clickedLng);
      const zone = await prisma.zone.upsert({
        where: { code: section.code },
        update: { name: section.name },
        create: { code: section.code, name: section.name }
      });
      resolvedZoneId = zone.id;
    }

    if (!resolvedZoneId) {
      return res.status(400).json({ message: "Could not determine section/zone for this family" });
    }

    const household = await createWithCodeRetry({
      model: "household",
      create: async (householdCode) =>
        prisma.household.create({
          data: {
            householdCode,
            firstName: payload.firstName,
            lastName: payload.lastName,
            fatherName: payload.fatherName,
            motherName: payload.motherName,
            civilIdentityNumber: payload.civilIdentityNumber,
            phoneNumber: payload.phoneNumber,
            pinLabel: payload.pinLabel ?? null,
            headName: normalizedHeadName,
            arrivalDate: new Date(payload.arrivalDate),
            originArea: payload.originArea ?? null,
            zoneId: resolvedZoneId,
            housingType: payload.housingType,
            familySize: memberSummary?.familySize ?? payload.familySize,
            status: payload.status,
            age0_4: memberSummary?.age0_4 ?? payload.age0_4,
            age5_17: memberSummary?.age5_17 ?? payload.age5_17,
            age18_59: memberSummary?.age18_59 ?? payload.age18_59,
            age60plus: memberSummary?.age60plus ?? payload.age60plus,
            vulnerabilityFlags: payload.vulnerabilityFlags,
            needs: payload.needs,
            notes: payload.notes ?? null,
            members: payload.members,
            safetyCheckStatus: payload.safetyCheckStatus,
            casePriority: payload.casePriority,
            nationality: payload.nationality ?? null,
            preferredLanguage: payload.preferredLanguage ?? null,
            emergencyName: payload.emergencyName ?? null,
            emergencyPhone: payload.emergencyPhone ?? null,
            emergencyRelation: payload.emergencyRelation ?? null,
            hasCar: payload.hasCar,
            carModel: payload.hasCar ? payload.carModel ?? null : null,
            carColor: payload.hasCar ? payload.carColor ?? null : null,
            carPlate: payload.hasCar ? payload.carPlate ?? null : null,
            isVerified: payload.safetyCheckStatus === FamilyCheckStatus.CHECKED_SAFE || payload.isVerified,
            checkedByUserId: payload.safetyCheckStatus === FamilyCheckStatus.CHECKED_SAFE ? req.user!.id : null,
            checkedAt: payload.safetyCheckStatus === FamilyCheckStatus.CHECKED_SAFE ? new Date() : null,
            approxLat: snapped?.approxLat,
            approxLng: snapped?.approxLng,
            pinPrecisionM: snapped?.pinPrecisionM ?? payload.pinPrecisionM
          },
          include: { zone: true }
        })
    });

    await writeAudit(req.user!.id, "CREATE", "Household", household.id);
    return res.status(201).json(household);
  })
);

householdsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const household = await prisma.household.findUnique({
      where: { id: req.params.id },
      include: {
        zone: true,
        rentalAgreements: {
          include: {
            housingUnit: true,
            landlord: true
          }
        },
        incidents: true,
        contact: true
      }
    });

    if (!household) {
      return res.status(404).json({ message: "Household not found" });
    }

    if (
      household.contact &&
      req.user!.role !== Role.ADMIN &&
      req.user!.role !== Role.CASE_WORKER
    ) {
      household.contact.phone = null;
      household.contact.whatsapp = null;
    }

    return res.json(household);
  })
);

householdsRouter.patch(
  "/:id",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(householdPatchSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof householdPatchSchema>;
    const existing = await prisma.household.findUnique({
      where: { id: req.params.id },
      select: { id: true, firstName: true, lastName: true }
    });

    if (!existing) {
      return res.status(404).json({ message: "Household not found" });
    }

    const members = payload.members ?? [];
    const memberSummary = payload.members ? summarizeMembers(members) : null;

    const pinPrecisionM = payload.pinPrecisionM ?? 0;
    const snapped =
      payload.clickedLat !== undefined && payload.clickedLng !== undefined
        ? resolvePin(payload.clickedLat, payload.clickedLng, pinPrecisionM)
        : null;

    const data: Record<string, unknown> = {
      ...payload,
      firstName: payload.firstName?.trim() || undefined,
      lastName: payload.lastName?.trim() || undefined,
      fatherName: payload.fatherName?.trim() || undefined,
      motherName: payload.motherName?.trim() || undefined,
      civilIdentityNumber: payload.civilIdentityNumber?.trim() || undefined,
      phoneNumber: payload.phoneNumber?.trim() || undefined,
      pinLabel: payload.pinLabel === undefined ? undefined : payload.pinLabel?.trim() || null,
      headName: payload.headName ?? undefined,
      originArea: payload.originArea ?? undefined,
      notes: payload.notes ?? undefined,
      nationality: payload.nationality ?? undefined,
      preferredLanguage: payload.preferredLanguage ?? undefined,
      emergencyName: payload.emergencyName ?? undefined,
      emergencyPhone: payload.emergencyPhone ?? undefined,
      emergencyRelation: payload.emergencyRelation ?? undefined
    };

    delete data.clickedLat;
    delete data.clickedLng;

    if (payload.hasCar === false) {
      data.carModel = null;
      data.carColor = null;
      data.carPlate = null;
    }

    if (payload.hasCar === true && (!payload.carModel || !payload.carColor || !payload.carPlate)) {
      return res.status(400).json({
        message: "carModel, carColor and carPlate are required when hasCar is true"
      });
    }

    if (payload.safetyCheckStatus) {
      const checkedSafe = payload.safetyCheckStatus === FamilyCheckStatus.CHECKED_SAFE;
      data.isVerified = checkedSafe;
      data.checkedByUserId = checkedSafe ? req.user!.id : null;
      data.checkedAt = checkedSafe ? new Date() : null;
    }

    if (payload.arrivalDate) {
      data.arrivalDate = new Date(payload.arrivalDate);
    }

    if (payload.firstName !== undefined || payload.lastName !== undefined || payload.headName !== undefined) {
      const firstName = payload.firstName?.trim() || existing.firstName || "";
      const lastName = payload.lastName?.trim() || existing.lastName || "";
      const mergedHeadName =
        payload.headName !== undefined ? payload.headName?.trim() || null : `${firstName} ${lastName}`.trim() || null;
      data.headName = mergedHeadName;
    }

    if (memberSummary) {
      data.familySize = memberSummary.familySize;
      data.age0_4 = memberSummary.age0_4;
      data.age5_17 = memberSummary.age5_17;
      data.age18_59 = memberSummary.age18_59;
      data.age60plus = memberSummary.age60plus;
    }

    if (snapped) {
      const section = sectionFromCoordinates(payload.clickedLat!, payload.clickedLng!);
      const zone = await prisma.zone.upsert({
        where: { code: section.code },
        update: { name: section.name },
        create: { code: section.code, name: section.name }
      });
      data.approxLat = snapped.approxLat;
      data.approxLng = snapped.approxLng;
      data.pinPrecisionM = snapped.pinPrecisionM;
      data.zoneId = zone.id;
    }

    const household = await prisma.household.update({
      where: { id: req.params.id },
      data,
      include: { zone: true }
    });

    await writeAudit(req.user!.id, "UPDATE", "Household", household.id);
    return res.json(household);
  })
);

householdsRouter.delete(
  "/:id",
  requireRoles(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await prisma.household.delete({ where: { id: req.params.id } });
    await writeAudit(req.user!.id, "DELETE", "Household", req.params.id);
    return res.status(204).send();
  })
);

householdsRouter.get(
  "/:id/contact",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  asyncHandler(async (req, res) => {
    const contact = await prisma.householdContact.findUnique({
      where: { householdId: req.params.id }
    });
    return res.json(contact);
  })
);

householdsRouter.put(
  "/:id/contact",
  requireRoles(Role.ADMIN, Role.CASE_WORKER),
  validateBody(contactSchema),
  asyncHandler(async (req, res) => {
    const contact = await prisma.householdContact.upsert({
      where: { householdId: req.params.id },
      update: req.body,
      create: { householdId: req.params.id, ...req.body }
    });

    await writeAudit(req.user!.id, "UPDATE", "HouseholdContact", contact.id);
    return res.json(contact);
  })
);

