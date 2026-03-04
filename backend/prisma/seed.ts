import "dotenv/config";
import bcrypt from "bcrypt";
import {
  PrismaClient,
  Role,
  HousingType,
  HouseholdStatus,
  HousingUnitStatus,
  RentalAgreementStatus,
  IncidentPriority,
  IncidentStatus,
  IncidentType,
  FamilyCheckStatus
} from "@prisma/client";

const prisma = new PrismaClient();

async function upsertUser(email: string, fullName: string, role: Role, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { fullName, role, passwordHash, isActive: true },
    create: { email, fullName, role, passwordHash, isActive: true }
  });
}

async function main() {
  await prisma.user.deleteMany({
    where: { email: "finance@municipality.local" }
  });

  const [admin, cw1, cw2, viewer, police] = await Promise.all([
    upsertUser("admin@municipality.local", "Admin User", Role.ADMIN, "ChangeMe123!"),
    upsertUser("caseworker1@municipality.local", "Case Worker One", Role.CASE_WORKER, "ChangeMe123!"),
    upsertUser("caseworker2@municipality.local", "Case Worker Two", Role.CASE_WORKER, "ChangeMe123!"),
    upsertUser("viewer@municipality.local", "Viewer User", Role.VIEWER, "ChangeMe123!"),
    upsertUser("police1@municipality.local", "Police Officer One", Role.POLICE, "ChangeMe123!")
  ]);

  const zones = await Promise.all(
    Array.from({ length: 10 }).map((_, idx) => {
      const section = idx + 1;
      const code = `SEC-${String(section).padStart(2, "0")}`;
      const name = `Section ${section}`;
      return prisma.zone.upsert({ where: { code }, update: { name }, create: { code, name } });
    })
  );

  const household = await prisma.household.upsert({
    where: { householdCode: "HH-00001" },
    update: {
      headName: "Sample Head",
      arrivalDate: new Date("2026-02-25"),
      originArea: "Demo Origin",
      zoneId: zones[4].id,
      housingType: HousingType.RENTAL,
      familySize: 5,
      status: HouseholdStatus.ACTIVE,
      age0_4: 1,
      age5_17: 2,
      age18_59: 1,
      age60plus: 1,
      vulnerabilityFlags: ["medical", "income"],
      needs: ["rent_support", "medicine"],
      notes: "Sample household for MVP",
      members: [
        { name: "Sample Head", age: 42, gender: "MALE", relationshipToHead: "HEAD", idDocStatus: "HAS_ID", idDocType: "NID", idDocLast4: "1234", employmentStatus: "EMPLOYED", schoolEnrollment: "NA" },
        { name: "Adult Member", age: 34, gender: "FEMALE", relationshipToHead: "SPOUSE", idDocStatus: "HAS_ID", idDocType: "NID", idDocLast4: "4321", employmentStatus: "UNEMPLOYED", schoolEnrollment: "NA" },
        { name: "Teen Member", age: 14, gender: "FEMALE", relationshipToHead: "DAUGHTER", idDocStatus: "NO_ID", schoolEnrollment: "ENROLLED", employmentStatus: "NA" },
        { name: "Child Member", age: 7, gender: "MALE", relationshipToHead: "SON", idDocStatus: "NO_ID", schoolEnrollment: "ENROLLED", employmentStatus: "NA" },
        { name: "Senior Member", age: 67, gender: "FEMALE", relationshipToHead: "MOTHER", idDocStatus: "HAS_ID", idDocType: "NID", idDocLast4: "5678", employmentStatus: "NA", schoolEnrollment: "NA", hasChronicCondition: true }
      ],
      safetyCheckStatus: FamilyCheckStatus.CHECKED_SAFE,
      casePriority: "MEDIUM",
      nationality: "Lebanese",
      preferredLanguage: "Arabic",
      emergencyName: "Relative Contact",
      emergencyPhone: "+96170000001",
      emergencyRelation: "Brother",
      hasCar: true,
      carModel: "Toyota Corolla",
      carColor: "White",
      carPlate: "LB-10234",
      isVerified: true,
      approxLat: 33.93444,
      approxLng: 35.69972,
      pinPrecisionM: 500
    },
    create: {
      householdCode: "HH-00001",
      headName: "Sample Head",
      arrivalDate: new Date("2026-02-25"),
      originArea: "Demo Origin",
      zoneId: zones[4].id,
      housingType: HousingType.RENTAL,
      familySize: 5,
      status: HouseholdStatus.ACTIVE,
      age0_4: 1,
      age5_17: 2,
      age18_59: 1,
      age60plus: 1,
      vulnerabilityFlags: ["medical", "income"],
      needs: ["rent_support", "medicine"],
      notes: "Sample household for MVP",
      members: [
        { name: "Sample Head", age: 42, gender: "MALE", relationshipToHead: "HEAD", idDocStatus: "HAS_ID", idDocType: "NID", idDocLast4: "1234", employmentStatus: "EMPLOYED", schoolEnrollment: "NA" },
        { name: "Adult Member", age: 34, gender: "FEMALE", relationshipToHead: "SPOUSE", idDocStatus: "HAS_ID", idDocType: "NID", idDocLast4: "4321", employmentStatus: "UNEMPLOYED", schoolEnrollment: "NA" },
        { name: "Teen Member", age: 14, gender: "FEMALE", relationshipToHead: "DAUGHTER", idDocStatus: "NO_ID", schoolEnrollment: "ENROLLED", employmentStatus: "NA" },
        { name: "Child Member", age: 7, gender: "MALE", relationshipToHead: "SON", idDocStatus: "NO_ID", schoolEnrollment: "ENROLLED", employmentStatus: "NA" },
        { name: "Senior Member", age: 67, gender: "FEMALE", relationshipToHead: "MOTHER", idDocStatus: "HAS_ID", idDocType: "NID", idDocLast4: "5678", employmentStatus: "NA", schoolEnrollment: "NA", hasChronicCondition: true }
      ],
      safetyCheckStatus: FamilyCheckStatus.CHECKED_SAFE,
      casePriority: "MEDIUM",
      nationality: "Lebanese",
      preferredLanguage: "Arabic",
      emergencyName: "Relative Contact",
      emergencyPhone: "+96170000001",
      emergencyRelation: "Brother",
      hasCar: true,
      carModel: "Toyota Corolla",
      carColor: "White",
      carPlate: "LB-10234",
      isVerified: true,
      approxLat: 33.93444,
      approxLng: 35.69972,
      pinPrecisionM: 500
    }
  });

  await prisma.householdContact.upsert({
    where: { householdId: household.id },
    update: { phone: "+96100000000", whatsapp: "+96100000000", consent: true },
    create: { householdId: household.id, phone: "+96100000000", whatsapp: "+96100000000", consent: true }
  });

  const unit = await prisma.housingUnit.upsert({
    where: { unitCode: "UNIT-0001" },
    update: {},
    create: {
      unitCode: "UNIT-0001",
      zoneId: zones[4].id,
      streetLabel: "Center Block A",
      type: "Apartment",
      rooms: 3,
      capacity: 6,
      utilities: { water: true, electricity: true },
      condition: "Good",
      status: HousingUnitStatus.OCCUPIED,
      notes: "Sample occupied unit"
    }
  });

  const landlord = await prisma.landlord.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Sample Landlord",
      phone: "+96100000001",
      notes: "Sample landlord"
    }
  });

  const agreement = await prisma.rentalAgreement.upsert({
    where: { agreementCode: "RA-0001" },
    update: {},
    create: {
      agreementCode: "RA-0001",
      householdId: household.id,
      housingUnitId: unit.id,
      landlordId: landlord.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-07-01"),
      monthlyRent: 350,
      deposit: 350,
      status: RentalAgreementStatus.ACTIVE,
      notes: "Sample active agreement"
    }
  });

  await prisma.incident.upsert({
    where: { incidentCode: "INC-0001" },
    update: {},
    create: {
      incidentCode: "INC-0001",
      householdId: household.id,
      type: IncidentType.HOUSING,
      priority: IncidentPriority.HIGH,
      description: "Water leak reported",
      assignedUserId: cw1.id,
      status: IncidentStatus.OPEN,
      dueDate: new Date("2026-03-10")
    }
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "SEED",
      entity: "SYSTEM",
      entityId: household.id
    }
  });

  console.log("Seed complete");
  console.log("Users:");
  console.log("admin@municipality.local / ChangeMe123!");
  console.log("caseworker1@municipality.local / ChangeMe123!");
  console.log("caseworker2@municipality.local / ChangeMe123!");
  console.log("viewer@municipality.local / ChangeMe123!");
  console.log("police1@municipality.local / ChangeMe123!");
  void cw2;
  void viewer;
  void police;
  void agreement;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

