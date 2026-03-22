-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "isAcademyCatalog" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "listedInPublicCatalog" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "buyerTenantId" TEXT;

-- CreateIndex
CREATE INDEX "Program_tenantId_listedInPublicCatalog_idx" ON "Program"("tenantId", "listedInPublicCatalog");

-- CreateIndex
CREATE INDEX "Payment_buyerTenantId_idx" ON "Payment"("buyerTenantId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_buyerTenantId_fkey" FOREIGN KEY ("buyerTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
