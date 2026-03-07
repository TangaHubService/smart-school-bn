-- AlterTable
ALTER TABLE "School"
ADD COLUMN "province" TEXT,
ADD COLUMN "sector" TEXT,
ADD COLUMN "cell" TEXT,
ADD COLUMN "village" TEXT;

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "phone" TEXT;
