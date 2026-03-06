import { Role } from "@prisma/client";
import { Router } from "express";
import * as XLSX from "xlsx";
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

function formatFullName(firstName: string | null, lastName: string | null, headName: string | null) {
  const full = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  if (full) {
    return full;
  }
  return (headName ?? "").trim();
}

function buildGoogleMapsLink(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) {
    return "";
  }
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function buildStaticMapImageUrl(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) {
    return "";
  }
  const center = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const marker = `${lat.toFixed(6)},${lng.toFixed(6)},red-pushpin`;
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${encodeURIComponent(
    center
  )}&zoom=16&size=640x360&markers=${encodeURIComponent(marker)}`;
}

function asString(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asBoolean(value: unknown) {
  return value === true;
}

function asMemberArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export const exportsRouter = Router();

exportsRouter.get(
  "/households-by-zone.csv",
  requireRoles(Role.ADMIN, Role.VIEWER, Role.CASE_WORKER),
  asyncHandler(async (_req, res) => {
    const households = await prisma.household.findMany({ include: { zone: true }, orderBy: { householdCode: "asc" } });

    const csv = toCsv(
      [
        "mapPinNumber",
        "householdCode",
        "fullName",
        "firstName",
        "lastName",
        "fatherName",
        "motherName",
        "civilIdentityNumber",
        "phoneNumber",
        "pinLabel",
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
        "pinPrecisionM",
        "locationLatLng",
        "googleMapsLink",
        "mapImageUrl"
      ],
      households.map((h, index) => {
        const locationLatLng =
          h.approxLat === null || h.approxLng === null ? "" : `${h.approxLat.toFixed(6)},${h.approxLng.toFixed(6)}`;
        return [
          index + 1,
          h.householdCode,
          formatFullName(h.firstName, h.lastName, h.headName),
          h.firstName,
          h.lastName,
          h.fatherName,
          h.motherName,
          h.civilIdentityNumber,
          h.phoneNumber,
          h.pinLabel,
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
          h.pinPrecisionM,
          locationLatLng,
          buildGoogleMapsLink(h.approxLat, h.approxLng),
          buildStaticMapImageUrl(h.approxLat, h.approxLng)
        ];
      })
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=households-by-zone.csv");
    return res.send(csv);
  })
);

exportsRouter.get(
  "/operations-report.xlsx",
  requireRoles(Role.ADMIN, Role.VIEWER, Role.CASE_WORKER),
  asyncHandler(async (_req, res) => {
    const households = await prisma.household.findMany({
      include: { zone: true },
      orderBy: { householdCode: "asc" }
    });

    const totalHouseholds = households.length;
    const totalIndividuals = households.reduce((sum, h) => sum + (h.familySize ?? 0), 0);
    const pendingChecks = households.filter((h) => h.safetyCheckStatus === "PENDING").length;
    const checkedSafe = households.filter((h) => h.safetyCheckStatus === "CHECKED_SAFE").length;
    const householdsWithCars = households.filter((h) => h.hasCar).length;

    const zoneStats = new Map<
      string,
      { zoneCode: string; zoneName: string; households: number; individuals: number; pendingChecks: number }
    >();
    for (const h of households) {
      const key = h.zone.id;
      if (!zoneStats.has(key)) {
        zoneStats.set(key, {
          zoneCode: h.zone.code,
          zoneName: h.zone.name,
          households: 0,
          individuals: 0,
          pendingChecks: 0
        });
      }
      const row = zoneStats.get(key)!;
      row.households += 1;
      row.individuals += h.familySize ?? 0;
      if (h.safetyCheckStatus === "PENDING") {
        row.pendingChecks += 1;
      }
    }

    const statsRows: Array<Array<string | number>> = [
      ["Metric", "Value"],
      ["Generated At (UTC)", new Date().toISOString()],
      ["Total Households", totalHouseholds],
      ["Total Individuals", totalIndividuals],
      ["Pending Safety Checks", pendingChecks],
      ["Checked Safe", checkedSafe],
      ["Households With Cars", householdsWithCars],
      [],
      ["Zone Code", "Zone Name", "Households", "Individuals", "Pending Checks"]
    ];

    for (const row of Array.from(zoneStats.values()).sort((a, b) => a.zoneName.localeCompare(b.zoneName))) {
      statsRows.push([row.zoneCode, row.zoneName, row.households, row.individuals, row.pendingChecks]);
    }

    const memberRows: Array<Array<string | number | boolean>> = [
      [
        "householdCode",
        "householdHeadName",
        "householdPhone",
        "zoneCode",
        "zoneName",
        "arrivalDate",
        "memberIndex",
        "memberName",
        "firstName",
        "lastName",
        "fatherName",
        "motherName",
        "civilIdentityNumber",
        "phoneNumber",
        "originArea",
        "nationality",
        "gender",
        "age",
        "relationshipToHead",
        "yearOfBirth",
        "idDocStatus",
        "idDocType",
        "idDocLast4",
        "schoolEnrollment",
        "employmentStatus",
        "memberSafetyCheckStatus",
        "hasDisability",
        "hasChronicCondition",
        "pregnantOrLactating",
        "hasCar",
        "carModel",
        "carColor",
        "carPlate",
        "householdLat",
        "householdLng",
        "googleMapsLink",
        "mapImageUrl"
      ]
    ];

    for (const h of households) {
      const members = asMemberArray(h.members);
      if (!members.length) {
        memberRows.push([
          h.householdCode,
          formatFullName(h.firstName, h.lastName, h.headName),
          h.phoneNumber ?? "",
          h.zone.code,
          h.zone.name,
          h.arrivalDate.toISOString().slice(0, 10),
          0,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          0,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          false,
          false,
          false,
          false,
          "",
          "",
          "",
          h.approxLat ?? "",
          h.approxLng ?? "",
          buildGoogleMapsLink(h.approxLat, h.approxLng),
          buildStaticMapImageUrl(h.approxLat, h.approxLng)
        ]);
        continue;
      }

      members.forEach((member, idx) => {
        const m = typeof member === "object" && member !== null ? (member as Record<string, unknown>) : {};
        memberRows.push([
          h.householdCode,
          formatFullName(h.firstName, h.lastName, h.headName),
          h.phoneNumber ?? "",
          h.zone.code,
          h.zone.name,
          h.arrivalDate.toISOString().slice(0, 10),
          idx + 1,
          asString(m.name),
          asString(m.firstName),
          asString(m.lastName),
          asString(m.fatherName),
          asString(m.motherName),
          asString(m.civilIdentityNumber),
          asString(m.phoneNumber),
          asString(m.originArea),
          asString(m.nationality),
          asString(m.gender),
          asNumber(m.age),
          asString(m.relationshipToHead),
          asString(m.yearOfBirth),
          asString(m.idDocStatus),
          asString(m.idDocType),
          asString(m.idDocLast4),
          asString(m.schoolEnrollment),
          asString(m.employmentStatus),
          asString(m.safetyCheckStatus),
          asBoolean(m.hasDisability),
          asBoolean(m.hasChronicCondition),
          asBoolean(m.pregnantOrLactating),
          asBoolean(m.hasCar),
          asString(m.carModel),
          asString(m.carColor),
          asString(m.carPlate),
          h.approxLat ?? "",
          h.approxLng ?? "",
          buildGoogleMapsLink(h.approxLat, h.approxLng),
          buildStaticMapImageUrl(h.approxLat, h.approxLng)
        ]);
      });
    }

    const workbook = XLSX.utils.book_new();
    const statsSheet = XLSX.utils.aoa_to_sheet(statsRows);
    const membersSheet = XLSX.utils.aoa_to_sheet(memberRows);
    XLSX.utils.book_append_sheet(workbook, statsSheet, "Stats");
    XLSX.utils.book_append_sheet(workbook, membersSheet, "All Members");
    const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=operations-report.xlsx");
    return res.send(fileBuffer);
  })
);

