-- CreateEnum
CREATE TYPE "EmergencyPlanType" AS ENUM ('SUSPICIOUS_VEHICLE', 'SUSPICIOUS_PERSON', 'ARMED_THREAT', 'MEDICAL_EMERGENCY', 'VILLAGE_LOCKDOWN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EmergencySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('POLICE', 'CHECKPOINT', 'MEDICAL');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('AVAILABLE', 'BUSY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('NOTIFIED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ARRIVED', 'INVESTIGATING', 'COMPLETED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "IncidentTimelineEventType" AS ENUM ('INCIDENT_CREATED', 'VEHICLE_UPDATED', 'PLAN_ACTIVATED', 'NOTIFICATIONS_SENT', 'OFFICER_ACKNOWLEDGED', 'UNIT_EN_ROUTE', 'UNIT_ARRIVED', 'CHECKPOINT_ACTIVATED', 'MEDICAL_SUPPORT_REQUESTED', 'INCIDENT_RESOLVED', 'INCIDENT_CLOSED', 'DISPATCH_STATUS_CHANGED', 'NOTE_ADDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IncidentStatus" ADD VALUE 'DRAFT';
ALTER TYPE "IncidentStatus" ADD VALUE 'REPORTED';
ALTER TYPE "IncidentStatus" ADD VALUE 'ACTIVE_RESPONSE';
ALTER TYPE "IncidentStatus" ADD VALUE 'CONTAINED';
ALTER TYPE "IncidentStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "EmergencyPlan" ADD COLUMN     "defaultNotificationMessage" TEXT,
ADD COLUMN     "defaultNotificationTitle" TEXT,
ADD COLUMN     "severity" "EmergencySeverity" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "type" "EmergencyPlanType" NOT NULL DEFAULT 'CUSTOM';

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "emergencyPlanId" TEXT,
ADD COLUMN     "locationLabel" TEXT,
ADD COLUMN     "locationLat" DOUBLE PRECISION,
ADD COLUMN     "locationLng" DOUBLE PRECISION,
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "severity" "EmergencySeverity" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "actionRequired" TEXT,
ADD COLUMN     "dispatchId" TEXT,
ADD COLUMN     "incidentId" TEXT,
ADD COLUMN     "incidentPriority" "IncidentPriority",
ADD COLUMN     "incidentSeverity" "EmergencySeverity",
ADD COLUMN     "incidentType" "IncidentType",
ADD COLUMN     "locationLabel" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "vehicleSummary" TEXT;

-- CreateTable
CREATE TABLE "IncidentVehicle" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "vehicleType" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "color" TEXT,
    "plateNumber" TEXT,
    "registrationCountry" TEXT,
    "directionOfTravel" TEXT,
    "passengerCount" INTEGER,
    "notes" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponseUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "UnitType" NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'AVAILABLE',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "assignedOfficerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponseUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentDispatch" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "officerId" TEXT,
    "status" "DispatchStatus" NOT NULL DEFAULT 'NOTIFIED',
    "notifiedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "enRouteAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidentDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentTimeline" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "eventType" "IncidentTimelineEventType" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyPlanStep" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "unitTypeRequired" "UnitType" NOT NULL DEFAULT 'POLICE',
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyPlanStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncidentVehicle_incidentId_key" ON "IncidentVehicle"("incidentId");

-- CreateIndex
CREATE INDEX "ResponseUnit_type_status_idx" ON "ResponseUnit"("type", "status");

-- CreateIndex
CREATE INDEX "IncidentDispatch_incidentId_status_idx" ON "IncidentDispatch"("incidentId", "status");

-- CreateIndex
CREATE INDEX "IncidentDispatch_officerId_status_idx" ON "IncidentDispatch"("officerId", "status");

-- CreateIndex
CREATE INDEX "IncidentTimeline_incidentId_createdAt_idx" ON "IncidentTimeline"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "EmergencyPlanStep_planId_isRequired_unitTypeRequired_idx" ON "EmergencyPlanStep"("planId", "isRequired", "unitTypeRequired");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyPlanStep_planId_stepOrder_key" ON "EmergencyPlanStep"("planId", "stepOrder");

-- CreateIndex
CREATE INDEX "EmergencyPlan_type_severity_isActive_idx" ON "EmergencyPlan"("type", "severity", "isActive");

-- CreateIndex
CREATE INDEX "Incident_status_priority_createdAt_idx" ON "Incident"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Incident_emergencyPlanId_idx" ON "Incident"("emergencyPlanId");

-- CreateIndex
CREATE INDEX "Notification_incidentId_createdAt_idx" ON "Notification"("incidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_emergencyPlanId_fkey" FOREIGN KEY ("emergencyPlanId") REFERENCES "EmergencyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentVehicle" ADD CONSTRAINT "IncidentVehicle_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponseUnit" ADD CONSTRAINT "ResponseUnit_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentDispatch" ADD CONSTRAINT "IncidentDispatch_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentDispatch" ADD CONSTRAINT "IncidentDispatch_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ResponseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentDispatch" ADD CONSTRAINT "IncidentDispatch_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTimeline" ADD CONSTRAINT "IncidentTimeline_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentTimeline" ADD CONSTRAINT "IncidentTimeline_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyPlanStep" ADD CONSTRAINT "EmergencyPlanStep_planId_fkey" FOREIGN KEY ("planId") REFERENCES "EmergencyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "IncidentDispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
