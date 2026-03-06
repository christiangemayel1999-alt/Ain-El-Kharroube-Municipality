-- CreateEnum
CREATE TYPE "MapReferenceType" AS ENUM (
  'ROAD',
  'IMPORTANT_BUILDING',
  'MUNICIPALITY_POINT',
  'CHECKPOINT',
  'SCHOOL',
  'CHURCH_MOSQUE',
  'SHELTER',
  'WATER_POINT',
  'LANDMARK',
  'CUSTOM'
);

-- CreateTable
CREATE TABLE "MapReference" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "MapReferenceType" NOT NULL,
  "description" TEXT,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "color" TEXT,
  "icon" TEXT,
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MapReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapReference_type_visible_idx" ON "MapReference"("type", "visible");

-- CreateIndex
CREATE INDEX "MapReference_visible_idx" ON "MapReference"("visible");
