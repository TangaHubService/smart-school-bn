-- CreateEnum
CREATE TYPE "AcademicAuditModule" AS ENUM (
  'ATTENDANCE',
  'COURSE_MANAGEMENT',
  'LEARNING_INSIGHTS',
  'CONTINUOUS_ASSESSMENTS',
  'MARKS',
  'TIMETABLE'
);

-- CreateTable
CREATE TABLE "AcademicAudit" (
  "id" TEXT NOT NULL,
  "auditorId" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "module" "AcademicAuditModule" NOT NULL,
  "subType" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "recommendation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademicAudit_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "AcademicAudit_auditorId_createdAt_idx" ON "AcademicAudit"("auditorId", "createdAt");
CREATE INDEX "AcademicAudit_schoolId_createdAt_idx" ON "AcademicAudit"("schoolId", "createdAt");
CREATE INDEX "AcademicAudit_module_createdAt_idx" ON "AcademicAudit"("module", "createdAt");
CREATE INDEX "AcademicAudit_tenantId_createdAt_idx" ON "AcademicAudit"("tenantId", "createdAt");

-- FKs
ALTER TABLE "AcademicAudit"
  ADD CONSTRAINT "AcademicAudit_auditorId_fkey"
  FOREIGN KEY ("auditorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AcademicAudit"
  ADD CONSTRAINT "AcademicAudit_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AcademicAudit"
  ADD CONSTRAINT "AcademicAudit_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
