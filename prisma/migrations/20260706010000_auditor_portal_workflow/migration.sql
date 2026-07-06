-- Add freeform (no auto-fetched summary) audit categories, a review note, evidence
-- attachments, and relax comment/recommendation to support saving audits as drafts
-- before they are submitted.
ALTER TYPE "AcademicAuditModule" ADD VALUE 'FINANCE';
ALTER TYPE "AcademicAuditModule" ADD VALUE 'TEACHERS';
ALTER TYPE "AcademicAuditModule" ADD VALUE 'STUDENT_RECORDS';
ALTER TYPE "AcademicAuditModule" ADD VALUE 'INFRASTRUCTURE';
ALTER TYPE "AcademicAuditModule" ADD VALUE 'ICT';
ALTER TYPE "AcademicAuditModule" ADD VALUE 'SAFETY';
ALTER TYPE "AcademicAuditModule" ADD VALUE 'COMPLIANCE';

ALTER TABLE "AcademicAudit"
  ALTER COLUMN "comment" DROP NOT NULL,
  ALTER COLUMN "recommendation" DROP NOT NULL,
  ADD COLUMN "reviewNote" TEXT;

CREATE TABLE "AcademicAuditAttachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicAuditAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AcademicAuditAttachment_tenantId_auditId_idx" ON "AcademicAuditAttachment"("tenantId", "auditId");

ALTER TABLE "AcademicAuditAttachment" ADD CONSTRAINT "AcademicAuditAttachment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicAuditAttachment" ADD CONSTRAINT "AcademicAuditAttachment_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "AcademicAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademicAuditAttachment" ADD CONSTRAINT "AcademicAuditAttachment_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
