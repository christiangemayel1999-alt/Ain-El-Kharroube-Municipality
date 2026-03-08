-- CreateEnum
CREATE TYPE "LocationUpdateSource" AS ENUM ('BROWSER_GEOLOCATION', 'SHARE_LINK', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "LocationSessionSource" AS ENUM ('AUTHENTICATED_USER', 'SHARE_TOKEN');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "liveLocationEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "liveLocationVisible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LocationShareToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationShareToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationSharingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "LocationSessionSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "stoppedReason" TEXT,
    "tokenId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationSharingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "tokenId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "LocationUpdateSource" NOT NULL,
    "batteryLevel" INTEGER,
    "isSharingSnapshot" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveLocationState" (
    "userId" TEXT NOT NULL,
    "isSharing" BOOLEAN NOT NULL DEFAULT false,
    "lastLatitude" DOUBLE PRECISION,
    "lastLongitude" DOUBLE PRECISION,
    "lastAccuracyM" DOUBLE PRECISION,
    "lastRecordedAt" TIMESTAMP(3),
    "lastReceivedAt" TIMESTAMP(3),
    "lastSource" "LocationUpdateSource",
    "lastBatteryLevel" INTEGER,
    "lastPointId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveLocationState_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationShareToken_tokenHash_key" ON "LocationShareToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LocationShareToken_userId_expiresAt_idx" ON "LocationShareToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "LocationShareToken_expiresAt_idx" ON "LocationShareToken"("expiresAt");

-- CreateIndex
CREATE INDEX "LocationShareToken_revokedAt_idx" ON "LocationShareToken"("revokedAt");

-- CreateIndex
CREATE INDEX "LocationSharingSession_userId_isActive_idx" ON "LocationSharingSession"("userId", "isActive");

-- CreateIndex
CREATE INDEX "LocationSharingSession_startedAt_idx" ON "LocationSharingSession"("startedAt");

-- CreateIndex
CREATE INDEX "LocationPoint_userId_receivedAt_idx" ON "LocationPoint"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "LocationPoint_userId_recordedAt_idx" ON "LocationPoint"("userId", "recordedAt");

-- CreateIndex
CREATE INDEX "LocationPoint_receivedAt_idx" ON "LocationPoint"("receivedAt");

-- CreateIndex
CREATE INDEX "LocationPoint_sessionId_receivedAt_idx" ON "LocationPoint"("sessionId", "receivedAt");

-- CreateIndex
CREATE INDEX "LiveLocationState_isSharing_lastReceivedAt_idx" ON "LiveLocationState"("isSharing", "lastReceivedAt");

-- CreateIndex
CREATE INDEX "LiveLocationState_lastReceivedAt_idx" ON "LiveLocationState"("lastReceivedAt");

-- AddForeignKey
ALTER TABLE "LocationShareToken" ADD CONSTRAINT "LocationShareToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShareToken" ADD CONSTRAINT "LocationShareToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSharingSession" ADD CONSTRAINT "LocationSharingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSharingSession" ADD CONSTRAINT "LocationSharingSession_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "LocationShareToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPoint" ADD CONSTRAINT "LocationPoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPoint" ADD CONSTRAINT "LocationPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LocationSharingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPoint" ADD CONSTRAINT "LocationPoint_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "LocationShareToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveLocationState" ADD CONSTRAINT "LiveLocationState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveLocationState" ADD CONSTRAINT "LiveLocationState_lastPointId_fkey" FOREIGN KEY ("lastPointId") REFERENCES "LocationPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;