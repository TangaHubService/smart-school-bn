-- AlterTable
ALTER TABLE "School" ADD COLUMN "adminCountryCode" TEXT,
ADD COLUMN "adminLevel1" TEXT,
ADD COLUMN "adminLevel2" TEXT,
ADD COLUMN "adminLevel3" TEXT,
ADD COLUMN "adminLevel4" TEXT;

-- CreateIndex
CREATE INDEX "School_adminCountryCode_adminLevel1_adminLevel2_idx" ON "School"("adminCountryCode", "adminLevel1", "adminLevel2");
