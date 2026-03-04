import { Role } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRoles } from "../middleware/rbac";
import { asyncHandler } from "../utils/asyncHandler";

function csvEscape(value: unknown) {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: unknown[][]) {
  const headerLine = headers.map(csvEscape).join(",");
  const lines = rows.map((row) => row.map(csvEscape).join(","));
  return [headerLine, ...lines].join("\n");
}

export const exportsRouter = Router();

exportsRouter.get(
  "/households-by-zone.csv",
  requireRoles(Role.ADMIN, Role.VIEWER, Role.CASE_WORKER),
  asyncHandler(async (_req, res) => {
    const households = await prisma.household.findMany({ include: { zone: true }, orderBy: { householdCode: "asc" } });

    const csv = toCsv(
      [
        "householdCode",
        "zoneCode",
        "zoneName",
        "arrivalDate",
        "status",
        "safetyCheckStatus",
        "casePriority",
        "nationality",
        "preferredLanguage",
        "emergencyName",
        "emergencyPhone",
        "emergencyRelation",
        "familySize",
        "hasCar",
        "carModel",
        "carColor",
        "carPlate",
        "approxLat",
        "approxLng",
        "pinPrecisionM"
      ],
      households.map((h) => [
        h.householdCode,
        h.zone.code,
        h.zone.name,
        h.arrivalDate.toISOString().slice(0, 10),
        h.status,
        h.safetyCheckStatus,
        h.casePriority,
        h.nationality,
        h.preferredLanguage,
        h.emergencyName,
        h.emergencyPhone,
        h.emergencyRelation,
        h.familySize,
        h.hasCar,
        h.carModel,
        h.carColor,
        h.carPlate,
        h.approxLat,
        h.approxLng,
        h.pinPrecisionM
      ])
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=households-by-zone.csv");
    return res.send(csv);
  })
);

