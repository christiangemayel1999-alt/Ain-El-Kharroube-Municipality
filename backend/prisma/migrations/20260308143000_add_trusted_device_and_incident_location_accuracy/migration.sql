-- CreateTable
CREATE TABLE "UserTrustedDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "persistentIdHash" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "deviceLabel" TEXT,
    "userAgent" TEXT,
    "platform" TEXT,
    "browserLanguage" TEXT,
    "timezone" TEXT,
    "screen" TEXT,
    "firstTrustedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetAt" TIMESTAMP(3),
    "resetByUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTrustedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserTrustedDevice_userId_key" ON "UserTrustedDevice"("userId");

-- CreateIndex
CREATE INDEX "UserTrustedDevice_isActive_lastSeenAt_idx" ON "UserTrustedDevice"("isActive", "lastSeenAt");

-- CreateIndex
CREATE INDEX "UserTrustedDevice_persistentIdHash_idx" ON "UserTrustedDevice"("persistentIdHash");

-- AlterTable
ALTER TABLE "LocationSharingSession"
ADD COLUMN "trustedDeviceId" TEXT;

-- CreateIndex
CREATE INDEX "LocationSharingSession_trustedDeviceId_isActive_idx" ON "LocationSharingSession"("trustedDeviceId", "isActive");

-- AlterTable
ALTER TABLE "Incident"
ADD COLUMN "locationAccuracyM" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "UserTrustedDevice" ADD CONSTRAINT "UserTrustedDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrustedDevice" ADD CONSTRAINT "UserTrustedDevice_resetByUserId_fkey" FOREIGN KEY ("resetByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSharingSession" ADD CONSTRAINT "LocationSharingSession_trustedDeviceId_fkey" FOREIGN KEY ("trustedDeviceId") REFERENCES "UserTrustedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;