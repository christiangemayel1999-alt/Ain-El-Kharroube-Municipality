import {
  CasePriority,
  FamilyCheckStatus,
  HousingType,
  Household,
  HouseholdStatus,
  Prisma
} from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "../lib/prisma";
import { createWithCodeRetry } from "../utils/code";
import { sectionFromCoordinates } from "../utils/sectioning";

type ImportIssue = {
  rowNumber: number;
  message: string;
};

type NormalizedRow = {
  rowNumber: number;
  values: Record<string, unknown>;
};

type GroupedRows = {
  key: string;
  rows: NormalizedRow[];
};

export type HouseholdImportSummary = {
  householdsImported: number;
  householdsCreated: number;
  householdsUpdated: number;
  membersImported: number;
  rowsWithWarnings: number;
  rowsSkipped: number;
  warnings: ImportIssue[];
  skipped: ImportIssue[];
};

const UNKNOWN_ZONE_CODE = "IMP-UNKNOWN";
const UNKNOWN_ZONE_NAME = "Imported - Unknown Zone";

function normalizeHeader(key: string) {
  return key.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeRow(
  row: Record<string, unknown>,
  rowNumber: number
): NormalizedRow {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    values[normalizeHeader(key)] = value;
  }
  return { rowNumber, values };
}

function readField(row: NormalizedRow, aliases: string[]) {
  for (const alias of aliases) {
    const value = row.values[normalizeHeader(alias)];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function asTrimmedString(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function asNullableString(value: unknown) {
  const normalized = asTrimmedString(value);
  return normalized.length ? normalized : null;
}

function asNumberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const str = asTrimmedString(value).replace(",", ".");
  if (!str.length) {
    return null;
  }
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : null;
}

function asIntegerOrNull(value: unknown) {
  const num = asNumberOrNull(value);
  if (num === null) {
    return null;
  }
  return Math.trunc(num);
}

function asBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const normalized = asTrimmedString(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["1", "true", "yes", "y", "x"].includes(normalized);
}

function asObject(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function clamp(value: number, min: number, max: number) {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function parseGender(value: unknown): "MALE" | "FEMALE" {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized.startsWith("F")) {
    return "FEMALE";
  }
  return "MALE";
}

function parseStatus(value: unknown) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === "MOVED_OUT") {
    return HouseholdStatus.MOVED_OUT;
  }
  if (normalized === "CLOSED") {
    return HouseholdStatus.CLOSED;
  }
  return HouseholdStatus.ACTIVE;
}

function parseHousingType(value: unknown) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === "RENTAL") {
    return HousingType.RENTAL;
  }
  if (normalized === "SHELTER") {
    return HousingType.SHELTER;
  }
  if (normalized === "OTHER") {
    return HousingType.OTHER;
  }
  return HousingType.HOST;
}

function parseSafetyStatus(value: unknown) {
  const normalized = asTrimmedString(value).toUpperCase();
  return normalized === "CHECKED_SAFE"
    ? FamilyCheckStatus.CHECKED_SAFE
    : FamilyCheckStatus.PENDING;
}

function parseCasePriority(value: unknown) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === "LOW") {
    return CasePriority.LOW;
  }
  if (normalized === "HIGH") {
    return CasePriority.HIGH;
  }
  return CasePriority.MEDIUM;
}

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(
        Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S)
      );
    }
  }

  const text = asTrimmedString(value);
  if (!text) {
    return null;
  }

  const exactDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (exactDate) {
    return new Date(
      Date.UTC(Number(exactDate[1]), Number(exactDate[2]) - 1, Number(exactDate[3]))
    );
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

function parseMapCoordinatesFromLink(link: string) {
  const qPattern = /[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i;
  const atPattern = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i;
  const llPattern = /[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i;
  const matched = qPattern.exec(link) ?? atPattern.exec(link) ?? llPattern.exec(link);
  if (!matched) {
    return null;
  }

  const lat = Number(matched[1]);
  const lng = Number(matched[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }

  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6))
  };
}

function splitHeadName(headName: string | null) {
  if (!headName) {
    return { firstName: null, lastName: null };
  }

  const parts = headName.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: null, lastName: null };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function sanitizeIdLast4(value: unknown) {
  const digits = asTrimmedString(value).replace(/\D/g, "");
  if (digits.length !== 4) {
    return null;
  }
  return digits;
}

function parseIdDocStatus(value: unknown) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === "HAS_ID") {
    return "HAS_ID";
  }
  if (normalized === "NO_ID") {
    return "NO_ID";
  }
  return "UNKNOWN";
}

function parseSchoolEnrollment(value: unknown) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === "ENROLLED") {
    return "ENROLLED";
  }
  if (normalized === "NOT_ENROLLED") {
    return "NOT_ENROLLED";
  }
  return "NA";
}

function parseEmploymentStatus(value: unknown) {
  const normalized = asTrimmedString(value).toUpperCase();
  if (normalized === "EMPLOYED") {
    return "EMPLOYED";
  }
  if (normalized === "UNEMPLOYED") {
    return "UNEMPLOYED";
  }
  return "NA";
}

function memberHasAnyData(row: NormalizedRow) {
  const candidateFields = [
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
    "relationshipToHead"
  ];

  for (const field of candidateFields) {
    const value = readField(row, [field]);
    if (asTrimmedString(value).length > 0) {
      return true;
    }
  }
  return false;
}

function computeAgeBuckets(members: Array<{ age: number }>) {
  const summary = {
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

function resolveFamilySafetyFromMembers(members: Array<Record<string, unknown>>) {
  if (!members.length) {
    return FamilyCheckStatus.PENDING;
  }

  const allCheckedSafe = members.every(
    (member) => parseSafetyStatus(member.safetyCheckStatus) === FamilyCheckStatus.CHECKED_SAFE
  );
  return allCheckedSafe ? FamilyCheckStatus.CHECKED_SAFE : FamilyCheckStatus.PENDING;
}

function firstNonEmpty(groups: NormalizedRow[], aliases: string[]) {
  for (const row of groups) {
    const value = asNullableString(readField(row, aliases));
    if (value) {
      return value;
    }
  }
  return null;
}

function toArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => asTrimmedString(item))
    .filter((item) => item.length > 0);
}

async function ensureZoneId(
  zoneCache: Map<string, string>,
  zoneCode: string,
  zoneName: string
) {
  const normalizedCode = zoneCode.toUpperCase();
  if (zoneCache.has(normalizedCode)) {
    return zoneCache.get(normalizedCode)!;
  }

  const zone = await prisma.zone.upsert({
    where: { code: normalizedCode },
    update: { name: zoneName },
    create: {
      code: normalizedCode,
      name: zoneName
    }
  });

  zoneCache.set(normalizedCode, zone.id);
  return zone.id;
}

function pickSheetWithMembers(workbook: XLSX.WorkBook) {
  const allMembersByName = workbook.SheetNames.find(
    (sheetName) => sheetName.trim().toLowerCase() === "all members"
  );
  if (allMembersByName) {
    return workbook.Sheets[allMembersByName];
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      range: 0,
      blankrows: false
    });
    const header = (headerRows[0] ?? [])
      .map((value) => normalizeHeader(asTrimmedString(value)))
      .filter((value) => value.length > 0);
    const hasHouseholdCode = header.includes("householdcode");
    const hasMemberName = header.includes("membername") || header.includes("firstname");
    if (hasHouseholdCode && hasMemberName) {
      return sheet;
    }
  }

  return null;
}

function groupRows(rows: NormalizedRow[]) {
  const map = new Map<string, GroupedRows>();

  for (const row of rows) {
    const householdCode = asTrimmedString(readField(row, ["householdCode"])).toUpperCase();
    const head = asTrimmedString(readField(row, ["householdHeadName", "headName"])).toLowerCase();
    const phone = asTrimmedString(readField(row, ["householdPhone", "phoneNumber"]));
    const zone = asTrimmedString(readField(row, ["zoneCode"])).toUpperCase();
    const arrivalDate = asTrimmedString(readField(row, ["arrivalDate"]));

    let key = "";
    if (householdCode) {
      key = `CODE:${householdCode}`;
    } else {
      const parts = [head, phone, zone, arrivalDate].filter((part) => part.length > 0);
      key = parts.length ? `GROUP:${parts.join("|")}` : `ROW:${row.rowNumber}`;
    }

    if (!map.has(key)) {
      map.set(key, { key, rows: [] });
    }
    map.get(key)!.rows.push(row);
  }

  return [...map.values()];
}

function hasAnyHouseholdData(group: GroupedRows) {
  for (const row of group.rows) {
    const keys = [
      "householdCode",
      "householdHeadName",
      "householdPhone",
      "zoneCode",
      "zoneName",
      "arrivalDate"
    ];
    for (const key of keys) {
      if (asTrimmedString(readField(row, [key])).length > 0) {
        return true;
      }
    }
    if (memberHasAnyData(row)) {
      return true;
    }
  }
  return false;
}

function mergeStringField(current: string | null, incoming: string | null) {
  if (current && current.trim().length > 0) {
    return current;
  }
  return incoming;
}

function parseIncomingMember(row: NormalizedRow, fallbackIndex: number) {
  if (!memberHasAnyData(row)) {
    return null;
  }

  const firstName = asNullableString(readField(row, ["firstName"]));
  const lastName = asNullableString(readField(row, ["lastName"]));
  const memberName =
    asNullableString(readField(row, ["memberName"])) ??
    ([firstName, lastName].filter(Boolean).join(" ").trim() || `Member ${fallbackIndex + 1}`);

  const age = clamp(asIntegerOrNull(readField(row, ["age"])) ?? 0, 0, 120);
  const yearOfBirth = asIntegerOrNull(readField(row, ["yearOfBirth"]));
  const idDocStatus = parseIdDocStatus(readField(row, ["idDocStatus"]));
  const hasCar = asBoolean(readField(row, ["hasCar"]));

  return {
    name: memberName,
    firstName,
    lastName,
    fatherName: asNullableString(readField(row, ["fatherName"])),
    motherName: asNullableString(readField(row, ["motherName"])),
    civilIdentityNumber: asNullableString(readField(row, ["civilIdentityNumber"])),
    phoneNumber: asNullableString(readField(row, ["phoneNumber"])),
    originArea: asNullableString(readField(row, ["originArea"])),
    nationality: asNullableString(readField(row, ["nationality"])),
    gender: parseGender(readField(row, ["gender"])),
    age,
    relationshipToHead: asNullableString(readField(row, ["relationshipToHead"])),
    yearOfBirth,
    idDocStatus,
    idDocType: asNullableString(readField(row, ["idDocType"])),
    idDocLast4: sanitizeIdLast4(readField(row, ["idDocLast4"])),
    schoolEnrollment: parseSchoolEnrollment(readField(row, ["schoolEnrollment"])),
    employmentStatus: parseEmploymentStatus(readField(row, ["employmentStatus"])),
    safetyCheckStatus: parseSafetyStatus(
      readField(row, ["memberSafetyCheckStatus", "safetyCheckStatus"])
    ),
    hasDisability: asBoolean(readField(row, ["hasDisability"])),
    hasChronicCondition: asBoolean(readField(row, ["hasChronicCondition"])),
    pregnantOrLactating: asBoolean(readField(row, ["pregnantOrLactating"])),
    hasCar,
    carModel: hasCar ? asNullableString(readField(row, ["carModel"])) : null,
    carColor: hasCar ? asNullableString(readField(row, ["carColor"])) : null,
    carPlate: hasCar ? asNullableString(readField(row, ["carPlate"])) : null
  };
}

function createWarningsCollector() {
  const warnings: ImportIssue[] = [];
  const warningRows = new Set<number>();

  return {
    warningRows,
    warnings,
    warn(rowNumber: number, message: string) {
      warnings.push({ rowNumber, message });
      warningRows.add(rowNumber);
    }
  };
}

function createSkippedCollector() {
  const skipped: ImportIssue[] = [];

  return {
    skipped,
    skip(rowNumber: number, message: string) {
      skipped.push({ rowNumber, message });
    }
  };
}

function isUniqueViolation(error: unknown, fieldName?: string) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== "P2002") {
    return false;
  }
  if (!fieldName) {
    return true;
  }
  return (
    Array.isArray(error.meta?.target) &&
    error.meta.target.some((target) => String(target).includes(fieldName))
  );
}

export async function importHouseholdsWorkbook(fileBuffer: Buffer) {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
  const sheet = pickSheetWithMembers(workbook);

  if (!sheet) {
    throw new Error("Could not find a members sheet. Expected 'All Members'.");
  }

  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true
  });

  const warningsCollector = createWarningsCollector();
  const skippedCollector = createSkippedCollector();
  const zoneCache = new Map<string, string>();

  let householdsCreated = 0;
  let householdsUpdated = 0;
  let membersImported = 0;

  if (!rawRows.length) {
    return {
      householdsImported: 0,
      householdsCreated: 0,
      householdsUpdated: 0,
      membersImported: 0,
      rowsWithWarnings: 0,
      rowsSkipped: 0,
      warnings: [],
      skipped: []
    } satisfies HouseholdImportSummary;
  }

  const normalizedRows = rawRows.map((row, idx) => normalizeRow(row, idx + 2));
  const groupedRows = groupRows(normalizedRows);

  const unknownZoneId = await ensureZoneId(
    zoneCache,
    UNKNOWN_ZONE_CODE,
    UNKNOWN_ZONE_NAME
  );

  for (const group of groupedRows) {
    const firstRowNumber = group.rows[0]?.rowNumber ?? 0;
    if (!hasAnyHouseholdData(group)) {
      for (const row of group.rows) {
        skippedCollector.skip(row.rowNumber, "Skipped empty row.");
      }
      continue;
    }

    const householdCodeRaw = firstNonEmpty(group.rows, ["householdCode"]);
    const householdCode = householdCodeRaw ? householdCodeRaw.toUpperCase() : null;
    const headName = firstNonEmpty(group.rows, ["householdHeadName", "headName"]);
    const householdPhone = firstNonEmpty(group.rows, ["householdPhone", "phoneNumber"]);
    const zoneCodeRaw = firstNonEmpty(group.rows, ["zoneCode"]);
    const zoneNameRaw = firstNonEmpty(group.rows, ["zoneName"]);
    const arrivalDateRaw = firstNonEmpty(group.rows, ["arrivalDate"]);
    const incomingArrivalDate = parseDate(arrivalDateRaw);
    const arrivalDate = incomingArrivalDate ?? new Date();
    if (!incomingArrivalDate && asTrimmedString(arrivalDateRaw).length) {
      warningsCollector.warn(
        firstRowNumber,
        `Invalid arrivalDate '${arrivalDateRaw}', defaulted to today.`
      );
    }

    const parsedHead = splitHeadName(headName);
    const members: Array<Record<string, unknown>> = [];

    for (const [index, row] of group.rows.entries()) {
      const parsedMember = parseIncomingMember(row, index);
      if (!parsedMember) {
        continue;
      }
      members.push(parsedMember);
    }

    const memberAges = members
      .map((member) => asIntegerOrNull(member.age))
      .filter((age): age is number => age !== null)
      .map((age) => clamp(age, 0, 120))
      .map((age) => ({ age }));
    const ageBuckets = computeAgeBuckets(memberAges);
    const familySafetyStatus = resolveFamilySafetyFromMembers(members);
    const familySize = Math.max(1, members.length);
    membersImported += members.length;

    const householdLat =
      asNumberOrNull(firstNonEmpty(group.rows, ["householdLat", "approxLat"])) ??
      null;
    const householdLng =
      asNumberOrNull(firstNonEmpty(group.rows, ["householdLng", "approxLng"])) ??
      null;

    let coords =
      householdLat !== null && householdLng !== null
        ? {
            lat: Number(clamp(householdLat, -90, 90).toFixed(6)),
            lng: Number(clamp(householdLng, -180, 180).toFixed(6))
          }
        : null;

    if (!coords) {
      const mapLink = firstNonEmpty(group.rows, ["googleMapsLink", "googleMapsUrl"]);
      if (mapLink) {
        coords = parseMapCoordinatesFromLink(mapLink);
      }
    }

    let zoneId = unknownZoneId;
    if (coords) {
      const section = sectionFromCoordinates(coords.lat, coords.lng);
      zoneId = await ensureZoneId(zoneCache, section.code, section.name);
    } else if (zoneCodeRaw) {
      zoneId = await ensureZoneId(
        zoneCache,
        zoneCodeRaw,
        zoneNameRaw ?? zoneCodeRaw
      );
    } else {
      warningsCollector.warn(
        firstRowNumber,
        "Missing coordinates and zone. Assigned to Imported - Unknown Zone."
      );
    }

    const firstMember = members[0] as Record<string, unknown> | undefined;

    const baseData: Omit<Prisma.HouseholdUncheckedCreateInput, "householdCode"> = {
      firstName: parsedHead.firstName,
      lastName: parsedHead.lastName,
      fatherName: asNullableString(firstMember?.fatherName ?? null),
      motherName: asNullableString(firstMember?.motherName ?? null),
      civilIdentityNumber: null,
      phoneNumber: householdPhone,
      pinLabel: firstNonEmpty(group.rows, ["pinLabel", "householdHeadName"]),
      headName,
      arrivalDate,
      originArea: asNullableString(firstMember?.originArea ?? null),
      zoneId,
      housingType: parseHousingType(firstNonEmpty(group.rows, ["housingType"])),
      familySize,
      status: parseStatus(firstNonEmpty(group.rows, ["status"])),
      age0_4: ageBuckets.age0_4,
      age5_17: ageBuckets.age5_17,
      age18_59: ageBuckets.age18_59,
      age60plus: ageBuckets.age60plus,
      vulnerabilityFlags: [] as Prisma.InputJsonValue,
      needs: [] as Prisma.InputJsonValue,
      notes: null,
      members: members as Prisma.InputJsonValue,
      safetyCheckStatus: familySafetyStatus,
      casePriority: parseCasePriority(firstNonEmpty(group.rows, ["casePriority"])),
      nationality: asNullableString(firstMember?.nationality ?? null),
      preferredLanguage: firstNonEmpty(group.rows, ["preferredLanguage"]),
      emergencyName: firstNonEmpty(group.rows, ["emergencyName"]),
      emergencyPhone: firstNonEmpty(group.rows, ["emergencyPhone"]),
      emergencyRelation: firstNonEmpty(group.rows, ["emergencyRelation"]),
      hasCar: members.some((member) => asBoolean(member.hasCar)),
      carModel: null,
      carColor: null,
      carPlate: null,
      isVerified: familySafetyStatus === FamilyCheckStatus.CHECKED_SAFE,
      checkedByUserId: null,
      checkedAt: null,
      approxLat: coords?.lat ?? null,
      approxLng: coords?.lng ?? null,
      pinPrecisionM: coords ? 0 : 500
    };

    try {
      let existing: Pick<
        Household,
        | "id"
        | "householdCode"
        | "firstName"
        | "lastName"
        | "fatherName"
        | "motherName"
        | "civilIdentityNumber"
        | "phoneNumber"
        | "pinLabel"
        | "headName"
        | "arrivalDate"
        | "originArea"
        | "zoneId"
        | "housingType"
        | "familySize"
        | "status"
        | "age0_4"
        | "age5_17"
        | "age18_59"
        | "age60plus"
        | "vulnerabilityFlags"
        | "needs"
        | "notes"
        | "members"
        | "safetyCheckStatus"
        | "casePriority"
        | "nationality"
        | "preferredLanguage"
        | "emergencyName"
        | "emergencyPhone"
        | "emergencyRelation"
        | "hasCar"
        | "carModel"
        | "carColor"
        | "carPlate"
        | "isVerified"
        | "approxLat"
        | "approxLng"
        | "pinPrecisionM"
      > | null = null;

      // Duplicate strategy:
      // 1) prefer exact householdCode match
      // 2) fallback to headName + householdPhone + arrivalDate (same day)
      // If matched, merge into existing record instead of creating a duplicate.
      if (householdCode) {
        existing = await prisma.household.findUnique({
          where: { householdCode },
          select: {
            id: true,
            householdCode: true,
            firstName: true,
            lastName: true,
            fatherName: true,
            motherName: true,
            civilIdentityNumber: true,
            phoneNumber: true,
            pinLabel: true,
            headName: true,
            arrivalDate: true,
            originArea: true,
            zoneId: true,
            housingType: true,
            familySize: true,
            status: true,
            age0_4: true,
            age5_17: true,
            age18_59: true,
            age60plus: true,
            vulnerabilityFlags: true,
            needs: true,
            notes: true,
            members: true,
            safetyCheckStatus: true,
            casePriority: true,
            nationality: true,
            preferredLanguage: true,
            emergencyName: true,
            emergencyPhone: true,
            emergencyRelation: true,
            hasCar: true,
            carModel: true,
            carColor: true,
            carPlate: true,
            isVerified: true,
            approxLat: true,
            approxLng: true,
            pinPrecisionM: true
          }
        });
      }

      if (!existing && headName && householdPhone) {
        const dayStart = new Date(arrivalDate);
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(arrivalDate);
        dayEnd.setUTCHours(23, 59, 59, 999);

        existing = await prisma.household.findFirst({
          where: {
            headName,
            phoneNumber: householdPhone,
            arrivalDate: {
              gte: dayStart,
              lte: dayEnd
            }
          },
          select: {
            id: true,
            householdCode: true,
            firstName: true,
            lastName: true,
            fatherName: true,
            motherName: true,
            civilIdentityNumber: true,
            phoneNumber: true,
            pinLabel: true,
            headName: true,
            arrivalDate: true,
            originArea: true,
            zoneId: true,
            housingType: true,
            familySize: true,
            status: true,
            age0_4: true,
            age5_17: true,
            age18_59: true,
            age60plus: true,
            vulnerabilityFlags: true,
            needs: true,
            notes: true,
            members: true,
            safetyCheckStatus: true,
            casePriority: true,
            nationality: true,
            preferredLanguage: true,
            emergencyName: true,
            emergencyPhone: true,
            emergencyRelation: true,
            hasCar: true,
            carModel: true,
            carColor: true,
            carPlate: true,
            isVerified: true,
            approxLat: true,
            approxLng: true,
            pinPrecisionM: true
          }
        });
      }

      if (existing) {
        const existingMembers = toArray(existing.members);
        const mergedMembers = members.length ? members : existingMembers;
        const mergedFamilySafetyStatus = resolveFamilySafetyFromMembers(
          mergedMembers.map((member) => asObject(member))
        );
        const mergedAges = mergedMembers
          .map((member) => asIntegerOrNull((member as Record<string, unknown>).age))
          .filter((age): age is number => age !== null)
          .map((age) => ({ age: clamp(age, 0, 120) }));
        const mergedBuckets = mergedAges.length
          ? computeAgeBuckets(mergedAges)
          : {
              age0_4: existing.age0_4,
              age5_17: existing.age5_17,
              age18_59: existing.age18_59,
              age60plus: existing.age60plus
            };

        await prisma.household.update({
          where: { id: existing.id },
          data: {
            firstName: mergeStringField(existing.firstName, baseData.firstName),
            lastName: mergeStringField(existing.lastName, baseData.lastName),
            fatherName: mergeStringField(existing.fatherName, baseData.fatherName),
            motherName: mergeStringField(existing.motherName, baseData.motherName),
            civilIdentityNumber: mergeStringField(
              existing.civilIdentityNumber,
              baseData.civilIdentityNumber
            ),
            phoneNumber: mergeStringField(existing.phoneNumber, baseData.phoneNumber),
            pinLabel: mergeStringField(existing.pinLabel, baseData.pinLabel),
            headName: mergeStringField(existing.headName, baseData.headName),
            arrivalDate: existing.arrivalDate,
            originArea: mergeStringField(existing.originArea, baseData.originArea),
            zoneId:
              existing.zoneId === unknownZoneId && baseData.zoneId !== unknownZoneId
                ? baseData.zoneId
                : existing.zoneId,
            housingType: existing.housingType ?? baseData.housingType,
            familySize: mergedMembers.length || existing.familySize,
            status: existing.status ?? baseData.status,
            age0_4: mergedBuckets.age0_4,
            age5_17: mergedBuckets.age5_17,
            age18_59: mergedBuckets.age18_59,
            age60plus: mergedBuckets.age60plus,
            vulnerabilityFlags: toStringArray(existing.vulnerabilityFlags),
            needs: toStringArray(existing.needs),
            notes: mergeStringField(existing.notes, baseData.notes),
            members: mergedMembers,
            safetyCheckStatus: mergedFamilySafetyStatus,
            casePriority: existing.casePriority ?? baseData.casePriority,
            nationality: mergeStringField(existing.nationality, baseData.nationality),
            preferredLanguage: mergeStringField(
              existing.preferredLanguage,
              baseData.preferredLanguage
            ),
            emergencyName: mergeStringField(existing.emergencyName, baseData.emergencyName),
            emergencyPhone: mergeStringField(
              existing.emergencyPhone,
              baseData.emergencyPhone
            ),
            emergencyRelation: mergeStringField(
              existing.emergencyRelation,
              baseData.emergencyRelation
            ),
            hasCar: existing.hasCar || baseData.hasCar,
            carModel: mergeStringField(existing.carModel, baseData.carModel),
            carColor: mergeStringField(existing.carColor, baseData.carColor),
            carPlate: mergeStringField(existing.carPlate, baseData.carPlate),
            isVerified: mergedFamilySafetyStatus === FamilyCheckStatus.CHECKED_SAFE,
            approxLat: existing.approxLat ?? baseData.approxLat,
            approxLng: existing.approxLng ?? baseData.approxLng,
            pinPrecisionM:
              existing.approxLat === null && existing.approxLng === null
                ? baseData.pinPrecisionM
                : existing.pinPrecisionM
          }
        });

        householdsUpdated += 1;
        continue;
      }

      if (householdCode) {
        try {
          await prisma.household.create({
            data: {
              householdCode,
              ...baseData
            } as Prisma.HouseholdUncheckedCreateInput
          });
          householdsCreated += 1;
          continue;
        } catch (error) {
          if (isUniqueViolation(error, "householdCode")) {
            warningsCollector.warn(
              firstRowNumber,
              `Household code ${householdCode} already exists. Created with next available code instead.`
            );
          } else {
            throw error;
          }
        }
      }

      await createWithCodeRetry({
        model: "household",
        create: async (nextCode) =>
          prisma.household.create({
            data: {
              householdCode: nextCode,
              ...baseData
            } as Prisma.HouseholdUncheckedCreateInput
          })
      });
      householdsCreated += 1;
    } catch (error) {
      let details = "Failed to import this household group.";
      if (isUniqueViolation(error, "civilIdentityNumber")) {
        details =
          "Duplicate civil identity number conflict. Household skipped for manual review.";
      }
      for (const row of group.rows) {
        skippedCollector.skip(row.rowNumber, details);
      }
      warningsCollector.warn(firstRowNumber, details);
    }
  }

  return {
    householdsImported: householdsCreated + householdsUpdated,
    householdsCreated,
    householdsUpdated,
    membersImported,
    rowsWithWarnings: warningsCollector.warningRows.size,
    rowsSkipped: skippedCollector.skipped.length,
    warnings: warningsCollector.warnings,
    skipped: skippedCollector.skipped
  } satisfies HouseholdImportSummary;
}
