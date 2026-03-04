CREATE TYPE "CasePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE "Household"
ADD COLUMN "casePriority" "CasePriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN "nationality" TEXT,
ADD COLUMN "preferredLanguage" TEXT,
ADD COLUMN "emergencyName" TEXT,
ADD COLUMN "emergencyPhone" TEXT,
ADD COLUMN "emergencyRelation" TEXT,
ADD COLUMN "checkedByUserId" TEXT,
ADD COLUMN "checkedAt" TIMESTAMP(3);