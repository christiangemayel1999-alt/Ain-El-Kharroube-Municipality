-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_rentalAgreementId_fkey";

-- AlterTable
ALTER TABLE "RentalAgreement" DROP COLUMN "paidBy",
DROP COLUMN "paymentMethod";

-- DropTable
DROP TABLE "Payment";

-- DropEnum
DROP TYPE "PaidBy";

-- DropEnum
DROP TYPE "PaymentMethod";

-- DropEnum
DROP TYPE "PaymentStatus";