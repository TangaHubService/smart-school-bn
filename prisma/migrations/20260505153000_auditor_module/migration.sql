-- CreateEnum
CREATE TYPE "AuditorLevel" AS ENUM ('NATIONAL', 'PROVINCE', 'DISTRICT', 'SECTOR');

-- CreateEnum
CREATE TYPE "AuditType" AS ENUM ('ACADEMIC', 'FINANCIAL', 'INFRASTRUCTURE', 'COMPLIANCE');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "Auditor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "AuditorLevel" NOT NULL DEFAULT 'NATIONAL',
    "country" TEXT NOT NULL DEFAULT 'Rwanda',
    "province" TEXT,
    "district" TEXT,
    "sector" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "auditorId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "auditType" "AuditType" NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "planNotes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditReport" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "teachingQuality" INTEGER NOT NULL,
    "infrastructure" INTEGER NOT NULL,
    "discipline" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "recommendations" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Auditor_userId_key" ON "Auditor"("userId");

-- CreateIndex
CREATE INDEX "Auditor_level_country_province_district_sector_idx" ON "Auditor"("level", "country", "province", "district", "sector");

-- CreateIndex
CREATE INDEX "Auditor_isActive_level_idx" ON "Auditor"("isActive", "level");

-- CreateIndex
CREATE INDEX "Audit_auditorId_status_plannedDate_idx" ON "Audit"("auditorId", "status", "plannedDate");

-- CreateIndex
CREATE INDEX "Audit_tenantId_plannedDate_idx" ON "Audit"("tenantId", "plannedDate");

-- CreateIndex
CREATE INDEX "Audit_schoolId_plannedDate_idx" ON "Audit"("schoolId", "plannedDate");

-- CreateIndex
CREATE UNIQUE INDEX "AuditReport_auditId_key" ON "AuditReport"("auditId");

-- CreateIndex
CREATE INDEX "AuditReport_submittedByUserId_submittedAt_idx" ON "AuditReport"("submittedByUserId", "submittedAt");

-- CreateIndex
CREATE INDEX "AuditReport_score_submittedAt_idx" ON "AuditReport"("score", "submittedAt");

-- AddForeignKey
ALTER TABLE "Auditor" ADD CONSTRAINT "Auditor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_auditorId_fkey" FOREIGN KEY ("auditorId") REFERENCES "Auditor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditReport" ADD CONSTRAINT "AuditReport_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
