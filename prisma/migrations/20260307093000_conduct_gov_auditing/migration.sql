-- CreateEnum
CREATE TYPE "ConductSeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ConductIncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ConductActionType" AS ENUM (
    'WARNING',
    'COUNSELING',
    'PARENT_MEETING',
    'COMMUNITY_SERVICE',
    'DETENTION',
    'SUSPENSION',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "ConductFeedbackAuthorType" AS ENUM ('SCHOOL_STAFF', 'GOV_AUDITOR');

-- CreateEnum
CREATE TYPE "GovScopeLevel" AS ENUM ('SECTOR', 'DISTRICT', 'PROVINCE', 'COUNTRY');

-- CreateTable
CREATE TABLE "ConductIncident" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classRoomId" TEXT,
    "reportedByUserId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "ConductSeverity" NOT NULL DEFAULT 'MODERATE',
    "status" "ConductIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "location" TEXT,
    "reporterNotes" TEXT,
    "resolutionSummary" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConductAction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "type" "ConductActionType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "actionDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConductFeedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorType" "ConductFeedbackAuthorType" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovAuditorScope" (
    "id" TEXT NOT NULL,
    "auditorUserId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "scopeLevel" "GovScopeLevel" NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'Rwanda',
    "province" TEXT,
    "district" TEXT,
    "sector" TEXT,
    "notes" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GovAuditorScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "School_country_province_district_sector_idx" ON "School"("country", "province", "district", "sector");

-- CreateIndex
CREATE INDEX "ConductIncident_tenantId_studentId_occurredAt_idx" ON "ConductIncident"("tenantId", "studentId", "occurredAt");

-- CreateIndex
CREATE INDEX "ConductIncident_tenantId_classRoomId_occurredAt_idx" ON "ConductIncident"("tenantId", "classRoomId", "occurredAt");

-- CreateIndex
CREATE INDEX "ConductIncident_tenantId_status_severity_occurredAt_idx" ON "ConductIncident"("tenantId", "status", "severity", "occurredAt");

-- CreateIndex
CREATE INDEX "ConductAction_tenantId_incidentId_actionDate_idx" ON "ConductAction"("tenantId", "incidentId", "actionDate");

-- CreateIndex
CREATE INDEX "ConductAction_tenantId_type_actionDate_idx" ON "ConductAction"("tenantId", "type", "actionDate");

-- CreateIndex
CREATE INDEX "ConductFeedback_tenantId_incidentId_createdAt_idx" ON "ConductFeedback"("tenantId", "incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "ConductFeedback_authorUserId_createdAt_idx" ON "ConductFeedback"("authorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "GovAuditorScope_auditorUserId_isActive_scopeLevel_idx" ON "GovAuditorScope"("auditorUserId", "isActive", "scopeLevel");

-- CreateIndex
CREATE INDEX "GovAuditorScope_scopeLevel_country_province_district_sector_idx" ON "GovAuditorScope"("scopeLevel", "country", "province", "district", "sector");

-- AddForeignKey
ALTER TABLE "ConductIncident" ADD CONSTRAINT "ConductIncident_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductIncident" ADD CONSTRAINT "ConductIncident_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductIncident" ADD CONSTRAINT "ConductIncident_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductIncident" ADD CONSTRAINT "ConductIncident_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductIncident" ADD CONSTRAINT "ConductIncident_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductAction" ADD CONSTRAINT "ConductAction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductAction" ADD CONSTRAINT "ConductAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ConductIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductAction" ADD CONSTRAINT "ConductAction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductFeedback" ADD CONSTRAINT "ConductFeedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductFeedback" ADD CONSTRAINT "ConductFeedback_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "ConductIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductFeedback" ADD CONSTRAINT "ConductFeedback_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovAuditorScope" ADD CONSTRAINT "GovAuditorScope_auditorUserId_fkey" FOREIGN KEY ("auditorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovAuditorScope" ADD CONSTRAINT "GovAuditorScope_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
