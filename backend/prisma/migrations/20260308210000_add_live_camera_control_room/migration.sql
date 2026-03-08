-- CreateEnum
CREATE TYPE "LiveCameraSessionStatus" AS ENUM (
  'CONNECTING',
  'LIVE',
  'PERMISSION_DENIED',
  'CAMERA_OFF',
  'NETWORK_WEAK',
  'ENDED',
  'FAILED'
);

-- CreateEnum
CREATE TYPE "LiveCameraEventType" AS ENUM (
  'CAMERA_SESSION_STARTED',
  'CAMERA_SESSION_STOPPED',
  'CAMERA_PERMISSION_DENIED',
  'CAMERA_STREAM_ENDED_UNEXPECTEDLY',
  'VIEWER_OPENED_STREAM',
  'VIEWER_SWITCHED_STREAM',
  'STREAM_SELECTED_IN_CONTROL_ROOM',
  'TRUSTED_DEVICE_MISMATCH_BLOCKED_CAMERA_START',
  'CAMERA_STATE_UPDATED'
);

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "canSendLiveCamera" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "visibleInControlRoom" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "LiveCameraSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sessionStatus" "LiveCameraSessionStatus" NOT NULL DEFAULT 'CONNECTING',
  "relatedLocationPointId" TEXT,
  "deviceLabel" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiveCameraSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveCameraEventLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" "LiveCameraEventType" NOT NULL,
  "eventSummary" TEXT,
  "metadata" JSONB,
  "liveCameraSessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LiveCameraEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveCameraSession_userId_isActive_idx" ON "LiveCameraSession"("userId", "isActive");

-- CreateIndex
CREATE INDEX "LiveCameraSession_sessionStatus_createdAt_idx" ON "LiveCameraSession"("sessionStatus", "createdAt");

-- CreateIndex
CREATE INDEX "LiveCameraSession_createdAt_idx" ON "LiveCameraSession"("createdAt");

-- CreateIndex
CREATE INDEX "LiveCameraSession_relatedLocationPointId_idx" ON "LiveCameraSession"("relatedLocationPointId");

-- CreateIndex
CREATE INDEX "LiveCameraEventLog_userId_createdAt_idx" ON "LiveCameraEventLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveCameraEventLog_actorUserId_createdAt_idx" ON "LiveCameraEventLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveCameraEventLog_eventType_createdAt_idx" ON "LiveCameraEventLog"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "LiveCameraEventLog_liveCameraSessionId_idx" ON "LiveCameraEventLog"("liveCameraSessionId");

-- AddForeignKey
ALTER TABLE "LiveCameraSession"
  ADD CONSTRAINT "LiveCameraSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveCameraSession"
  ADD CONSTRAINT "LiveCameraSession_relatedLocationPointId_fkey"
  FOREIGN KEY ("relatedLocationPointId") REFERENCES "LocationPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveCameraEventLog"
  ADD CONSTRAINT "LiveCameraEventLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveCameraEventLog"
  ADD CONSTRAINT "LiveCameraEventLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveCameraEventLog"
  ADD CONSTRAINT "LiveCameraEventLog_liveCameraSessionId_fkey"
  FOREIGN KEY ("liveCameraSessionId") REFERENCES "LiveCameraSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

