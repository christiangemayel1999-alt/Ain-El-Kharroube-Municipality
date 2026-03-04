import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

const uniqueCodeFieldByModel = {
  household: "householdCode",
  unit: "unitCode",
  agreement: "agreementCode",
  incident: "incidentCode"
} as const;

export async function nextCode(model: "household" | "unit" | "agreement" | "incident") {
  const config = {
    household: { prefix: "HH", digits: 5 },
    unit: { prefix: "UNIT", digits: 4 },
    agreement: { prefix: "RA", digits: 4 },
    incident: { prefix: "INC", digits: 4 }
  } as const;

  const { prefix, digits } = config[model];
  const codeRegex = new RegExp(`^${prefix}-(\\d+)$`);
  const allCodes =
    model === "household"
      ? (await prisma.household.findMany({ select: { householdCode: true } })).map((row) => row.householdCode)
      : model === "unit"
        ? (await prisma.housingUnit.findMany({ select: { unitCode: true } })).map((row) => row.unitCode)
        : model === "agreement"
          ? (await prisma.rentalAgreement.findMany({ select: { agreementCode: true } })).map((row) => row.agreementCode)
          : (await prisma.incident.findMany({ select: { incidentCode: true } })).map((row) => row.incidentCode);

  let maxCodeNumber = 0;
  for (const code of allCodes) {
    const match = codeRegex.exec(code);
    if (!match) {
      continue;
    }
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > maxCodeNumber) {
      maxCodeNumber = value;
    }
  }

  const nextNumber = maxCodeNumber + 1;
  return `${prefix}-${String(nextNumber).padStart(digits, "0")}`;
}

export async function createWithCodeRetry<T>(params: {
  model: "household" | "unit" | "agreement" | "incident";
  attempts?: number;
  create: (code: string) => Promise<T>;
}) {
  const maxAttempts = params.attempts ?? 20;
  const codeField = uniqueCodeFieldByModel[params.model];
  let lastError: unknown = null;

  for (let i = 0; i < maxAttempts; i += 1) {
    const code = await nextCode(params.model);
    try {
      return await params.create(code);
    } catch (error) {
      const isCodeCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes(codeField);

      if (isCodeCollision) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 5 + Math.floor(Math.random() * 15)));
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error(`Could not create ${params.model} with a unique code`);
}

