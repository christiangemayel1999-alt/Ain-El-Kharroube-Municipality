import "dotenv/config";
import bcrypt from "bcrypt";
import {
  PrismaClient,
  Role,
  HousingType,
  HouseholdStatus,
  HousingUnitStatus,
  RentalAgreementStatus,
  EmergencyPlanType,
  EmergencySeverity,
  UnitStatus,
  UnitType,
  DispatchStatus,
  IncidentTimelineEventType,
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
      firstName: "Sample",
      lastName: "Head",
      fatherName: "Father Sample",
      motherName: "Mother Sample",
      civilIdentityNumber: "CID-00001",
      phoneNumber: "+96170000001",
      pinLabel: "Center-Alpha",
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
      firstName: "Sample",
      lastName: "Head",
      fatherName: "Father Sample",
      motherName: "Mother Sample",
      civilIdentityNumber: "CID-00001",
      phoneNumber: "+96170000001",
      pinLabel: "Center-Alpha",
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

  const incident = await prisma.incident.upsert({
    where: { incidentCode: "INC-0001" },
    update: {
      title: "Suspicious vehicle near east entrance",
      type: IncidentType.PROTECTION,
      priority: IncidentPriority.HIGH,
      severity: EmergencySeverity.HIGH,
      description: "White SUV circling checkpoint repeatedly.",
      assignedUserId: cw1.id,
      emergencyPlanId: null,
      locationLabel: "East Entrance",
      locationLat: 33.936665,
      locationLng: 35.699494,
      status: IncidentStatus.REPORTED,
      dueDate: new Date("2026-03-10")
    },
    create: {
      incidentCode: "INC-0001",
      title: "Suspicious vehicle near east entrance",
      householdId: household.id,
      type: IncidentType.PROTECTION,
      priority: IncidentPriority.HIGH,
      severity: EmergencySeverity.HIGH,
      description: "White SUV circling checkpoint repeatedly.",
      assignedUserId: cw1.id,
      locationLabel: "East Entrance",
      locationLat: 33.936665,
      locationLng: 35.699494,
      status: IncidentStatus.REPORTED,
      dueDate: new Date("2026-03-10")
    }
  });

  await prisma.incidentVehicle.upsert({
    where: { incidentId: incident.id },
    update: {
      vehicleType: "SUV",
      brand: "Hyundai",
      model: "Tucson",
      color: "White",
      plateNumber: "B 284763",
      registrationCountry: "LB",
      directionOfTravel: "Toward east checkpoint",
      passengerCount: 2,
      notes: "Driver slowed down at checkpoint and left quickly",
      photoUrl: null
    },
    create: {
      incidentId: incident.id,
      vehicleType: "SUV",
      brand: "Hyundai",
      model: "Tucson",
      color: "White",
      plateNumber: "B 284763",
      registrationCountry: "LB",
      directionOfTravel: "Toward east checkpoint",
      passengerCount: 2,
      notes: "Driver slowed down at checkpoint and left quickly",
      photoUrl: null
    }
  });

  await prisma.incidentTimeline.create({
    data: {
      incidentId: incident.id,
      eventType: IncidentTimelineEventType.INCIDENT_CREATED,
      message: "Incident was created during seed data setup.",
      createdById: admin.id
    }
  });

  await prisma.responseUnit.deleteMany({});
  await prisma.responseUnit.createMany({
    data: [
      {
        name: "Patrol Alpha",
        type: UnitType.POLICE,
        status: UnitStatus.AVAILABLE,
        latitude: 33.9348,
        longitude: 35.6996,
        assignedOfficerId: police.id
      },
      {
        name: "Checkpoint East",
        type: UnitType.CHECKPOINT,
        status: UnitStatus.AVAILABLE,
        latitude: 33.9369,
        longitude: 35.7005,
        assignedOfficerId: null
      },
      {
        name: "Medical Team 1",
        type: UnitType.MEDICAL,
        status: UnitStatus.AVAILABLE,
        latitude: 33.9339,
        longitude: 35.6989,
        assignedOfficerId: null
      }
    ]
  });

  await prisma.emergencyPlan.deleteMany({});
  const suspiciousVehiclePlan = await prisma.emergencyPlan.create({
    data: {
      name: "Suspicious Vehicle",
      type: EmergencyPlanType.SUSPICIOUS_VEHICLE,
      severity: EmergencySeverity.HIGH,
      description: "Rapid response protocol for suspicious vehicle activity.",
      defaultNotificationTitle: "Suspicious Vehicle Alert",
      defaultNotificationMessage:
        "Proceed immediately to incident location, identify vehicle, and report status.",
      isActive: true,
      createdByUserId: admin.id,
      steps: {
        create: [
          {
            stepOrder: 1,
            title: "Acknowledge alert",
            description: "Nearest patrol confirms receipt and starts movement.",
            icon: "🚓",
            unitTypeRequired: UnitType.POLICE,
            isRequired: true
          },
          {
            stepOrder: 2,
            title: "Activate checkpoint watch",
            description: "Checkpoint unit is informed to monitor exits.",
            icon: "🚧",
            unitTypeRequired: UnitType.CHECKPOINT,
            isRequired: true
          },
          {
            stepOrder: 3,
            title: "Prepare medical backup",
            description: "Medical team is alerted in standby mode.",
            icon: "🚑",
            unitTypeRequired: UnitType.MEDICAL,
            isRequired: false
          }
        ]
      },
      policePosts: {
        create: [
          {
            label: "East Entrance",
            lat: 33.9369,
            lng: 35.7005,
            officersCount: 2
          }
        ]
      }
    }
  });

  await prisma.emergencyPlan.create({
    data: {
      name: "Suspicious Person",
      type: EmergencyPlanType.SUSPICIOUS_PERSON,
      severity: EmergencySeverity.MEDIUM,
      description: "Field verification and containment protocol.",
      defaultNotificationTitle: "Suspicious Person Alert",
      defaultNotificationMessage: "Move to location, verify identity, and report to command center.",
      isActive: false,
      createdByUserId: admin.id,
      steps: {
        create: [
          {
            stepOrder: 1,
            title: "Nearest unit investigate",
            icon: "⚠️",
            unitTypeRequired: UnitType.POLICE,
            isRequired: true
          }
        ]
      }
    }
  });

  await prisma.incident.update({
    where: { id: incident.id },
    data: {
      emergencyPlanId: suspiciousVehiclePlan.id
    }
  });

  const patrolAlpha = await prisma.responseUnit.findFirst({
    where: { name: "Patrol Alpha" }
  });
  if (patrolAlpha) {
    const dispatch = await prisma.incidentDispatch.create({
      data: {
        incidentId: incident.id,
        unitId: patrolAlpha.id,
        officerId: police.id,
        status: DispatchStatus.NOTIFIED,
        notifiedAt: new Date(),
        notes: "Initial seeded dispatch"
      }
    });

    await prisma.notification.create({
      data: {
        userId: police.id,
        title: "🚨 Suspicious Vehicle Alert",
        message:
          "Plate: B 284763 | Vehicle: White Hyundai Tucson | Location: East Entrance | Action: Proceed immediately and confirm receipt.",
        incidentId: incident.id,
        dispatchId: dispatch.id,
        incidentType: IncidentType.PROTECTION,
        incidentPriority: IncidentPriority.HIGH,
        incidentSeverity: EmergencySeverity.HIGH,
        locationLabel: "East Entrance",
        vehicleSummary: "White Hyundai Tucson - B 284763",
        actionRequired: "Acknowledge and move to location",
        emergencyPlanId: suspiciousVehiclePlan.id,
        policePostLabel: "East Entrance",
        targetLat: 33.9369,
        targetLng: 35.7005
      }
    });
  }

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
  void incident;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

