-- CreateEnum
CREATE TYPE "TrackingPingStatus" AS ENUM ('PENDING', 'OPENED', 'RESPONDED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrackingEventType" AS ENUM (
  'TRUSTED_DEVICE_ASSIGNED',
  'TRUSTED_DEVICE_RESET',
  'LIVE_TRACKING_STARTED',
  'LIVE_TRACKING_STOPPED',
  'LIVE_TRACKING_UPDATE_RECEIVED',
  'LIVE_TRACKING_BECAME_STALE',
  'PING_REQUESTED',
  'PING_NOTIFICATION_DELIVERED',
  'PING_OPENED',
  'PING_LOCATION_RESPONDED',
  'PING_EXPIRED',
  'PING_CANCELLED',
  'PING_FAILED',
  'GEOLOCATION_PERMISSION_DENIED',
  'GEOLOCATION_UNAVAILABLE',
  'USER_HIDDEN_FROM_MAP',
  'TRACKING_SENDER_DISABLED',
  'UNAUTHORIZED_TRACKING_ACTION_ATTEMPT',
  'STOP_ACTIVE_TRACKING_SESSION',
  'PUSH_SUBSCRIPTION_REGISTERED',
  'PUSH_SUBSCRIPTION_REMOVED',
  'PUSH_NOTIFICATION_FAILED'
);

-- CreateEnum
CREATE TYPE "IncidentLocationSource" AS ENUM ('GPS_FRESH', 'GPS_RECENT', 'MANUAL', 'LIVE_TRACKING_RECENT');

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN "locationSource" "IncidentLocationSource";

-- CreateTable
CREATE TABLE "LocationPingRequest" (
  "id" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "TrackingPingStatus" NOT NULL DEFAULT 'PENDING',
  "requestMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "openedAt" TIMESTAMP(3),
  "respondedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "lastError" TEXT,
  "locationPointId" TEXT,
  "isLateResponse" BOOLEAN NOT NULL DEFAULT false,
  "notificationDeliveredAt" TIMESTAMP(3),

  CONSTRAINT "LocationPingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEventLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" "TrackingEventType" NOT NULL,
  "eventSummary" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "relatedPingRequestId" TEXT,
  "relatedSessionId" TEXT,
  "relatedTrustedDeviceId" TEXT,

  CONSTRAINT "TrackingEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "expirationTime" TIMESTAMP(3),
  "userAgent" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSuccessAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastFailureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationPingRequest_targetUserId_createdAt_idx" ON "LocationPingRequest"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationPingRequest_requestedByUserId_createdAt_idx" ON "LocationPingRequest"("requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LocationPingRequest_status_expiresAt_idx" ON "LocationPingRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "LocationPingRequest_createdAt_idx" ON "LocationPingRequest"("createdAt");

-- CreateIndex
CREATE INDEX "TrackingEventLog_userId_createdAt_idx" ON "TrackingEventLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingEventLog_actorUserId_createdAt_idx" ON "TrackingEventLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingEventLog_eventType_createdAt_idx" ON "TrackingEventLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "TrackingEventLog_relatedPingRequestId_idx" ON "TrackingEventLog"("relatedPingRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_isActive_idx" ON "PushSubscription"("userId", "isActive");

-- CreateIndex
CREATE INDEX "PushSubscription_createdAt_idx" ON "PushSubscription"("createdAt");

-- AddForeignKey
ALTER TABLE "LocationPingRequest" ADD CONSTRAINT "LocationPingRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPingRequest" ADD CONSTRAINT "LocationPingRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPingRequest" ADD CONSTRAINT "LocationPingRequest_locationPointId_fkey" FOREIGN KEY ("locationPointId") REFERENCES "LocationPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEventLog" ADD CONSTRAINT "TrackingEventLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEventLog" ADD CONSTRAINT "TrackingEventLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEventLog" ADD CONSTRAINT "TrackingEventLog_relatedPingRequestId_fkey" FOREIGN KEY ("relatedPingRequestId") REFERENCES "LocationPingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEventLog" ADD CONSTRAINT "TrackingEventLog_relatedSessionId_fkey" FOREIGN KEY ("relatedSessionId") REFERENCES "LocationSharingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEventLog" ADD CONSTRAINT "TrackingEventLog_relatedTrustedDeviceId_fkey" FOREIGN KEY ("relatedTrustedDeviceId") REFERENCES "UserTrustedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
