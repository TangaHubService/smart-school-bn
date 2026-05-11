-- CreateEnum
CREATE TYPE "AcademicAuditStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVISION');

-- AlterTable
ALTER TABLE "AcademicAudit" ADD COLUMN     "status" "AcademicAuditStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "AcademicAudit" ADD COLUMN     "submittedAt" TIMESTAMP(3);
ALTER TABLE "AcademicAudit" ADD COLUMN     "reviewedAt" TIMESTAMP(3);
ALTER TABLE "AcademicAudit" ADD COLUMN     "reviewedById" TEXT;
ALTER TABLE "AcademicAudit" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "AcademicAudit_status_createdAt_idx" ON "AcademicAudit"("status", "createdAt");
CREATE INDEX "AcademicAudit_reviewedById_idx" ON "AcademicAudit"("reviewedById");

-- AddForeignKey
ALTER TABLE "AcademicAudit" ADD CONSTRAINT "AcademicAudit_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;