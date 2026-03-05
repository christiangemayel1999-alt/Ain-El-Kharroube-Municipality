ALTER TABLE "Household"
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "fatherName" TEXT,
ADD COLUMN "motherName" TEXT,
ADD COLUMN "civilIdentityNumber" TEXT,
ADD COLUMN "phoneNumber" TEXT,
ADD COLUMN "pinLabel" TEXT;

CREATE UNIQUE INDEX "Household_civilIdentityNumber_key" ON "Household"("civilIdentityNumber");
