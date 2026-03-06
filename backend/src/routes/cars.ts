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

function asMemberArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function asBoolean(value: unknown) {
  return value === true;
}

export const carsRouter = Router();

carsRouter.get(
  "/",
  requireRoles(Role.ADMIN, Role.CASE_WORKER, Role.VIEWER, Role.POLICE, Role.FINANCE),
  validateQuery(carsQuerySchema),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof carsQuerySchema>;
    const search = query.q?.trim();

    const households = await prisma.household.findMany({
      where: {
        safetyCheckStatus: query.safetyCheckStatus
      },
      include: {
        zone: true
      },
      orderBy: [{ createdAt: "desc" }]
    });

    const rows = households.flatMap((household) => {
      const members = asMemberArray(household.members);
      return members
        .map((member, memberIndex) => ({ member: asObject(member), memberIndex }))
        .filter(({ member }) => asBoolean(member.hasCar))
        .map(({ member, memberIndex }) => ({
          recordId: `${household.id}:${memberIndex}`,
          householdId: household.id,
          householdCode: household.householdCode,
          firstName: household.firstName,
          lastName: household.lastName,
          fatherName: household.fatherName,
          motherName: household.motherName,
          headName: household.headName,
          civilIdentityNumber: household.civilIdentityNumber,
          phoneNumber: household.phoneNumber,
          originArea: household.originArea,
          safetyCheckStatus: household.safetyCheckStatus,
          casePriority: household.casePriority,
          carModel: asString(member.carModel) || null,
          carColor: asString(member.carColor) || null,
          carPlate: asString(member.carPlate) || null,
          memberIndex: memberIndex + 1,
          memberName: asString(member.name) || null,
          memberFirstName: asString(member.firstName) || null,
          memberLastName: asString(member.lastName) || null,
          memberFatherName: asString(member.fatherName) || null,
          memberMotherName: asString(member.motherName) || null,
          memberCivilIdentityNumber: asString(member.civilIdentityNumber) || null,
          memberPhoneNumber: asString(member.phoneNumber) || null,
          memberRelationshipToHead: asString(member.relationshipToHead) || null,
          zone: household.zone,
          createdAt: household.createdAt
        }));
    });

    const filtered = rows.filter((row) => {
      if (query.model && !(row.carModel || "").toLowerCase().includes(query.model.toLowerCase())) {
        return false;
      }

      if (query.color && !(row.carColor || "").toLowerCase().includes(query.color.toLowerCase())) {
        return false;
      }

      if (!search) {
        return true;
      }

      const haystack = [
        row.householdCode,
        row.firstName ?? "",
        row.lastName ?? "",
        row.headName ?? "",
        row.civilIdentityNumber ?? "",
        row.memberName ?? "",
        row.memberFirstName ?? "",
        row.memberLastName ?? "",
        row.memberCivilIdentityNumber ?? "",
        row.memberPhoneNumber ?? "",
        row.carPlate ?? "",
        row.carModel ?? "",
        row.carColor ?? ""
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(search.toLowerCase());
    });

    filtered.sort((a, b) => {
      const plateA = a.carPlate ?? "";
      const plateB = b.carPlate ?? "";
      if (plateA !== plateB) {
        return plateA.localeCompare(plateB, undefined, { numeric: true, sensitivity: "base" });
      }
      return a.householdCode.localeCompare(b.householdCode, undefined, { numeric: true, sensitivity: "base" });
    });

    return res.json(filtered);
  })
);
