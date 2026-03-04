-- Add structured household members intake (name + age)
ALTER TABLE "Household"
ADD COLUMN "members" JSONB NOT NULL DEFAULT '[]';