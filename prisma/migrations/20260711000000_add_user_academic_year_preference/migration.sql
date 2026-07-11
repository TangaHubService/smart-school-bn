-- Backfill migration: the UserAcademicYearPreference model was added to
-- schema.prisma in ec65e46 (academic year pref feature) without a matching
-- migration, so the table was never created outside of dev DBs that had
-- `prisma db push` run against them. Every caller of resolveAcademicYearId()
-- (courses, assessments, chat, lesson-plans) 500s in any environment that
-- only applies migrations.
CREATE TABLE "UserAcademicYearPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAcademicYearPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserAcademicYearPreference_userId_key" ON "UserAcademicYearPreference"("userId");
CREATE INDEX "UserAcademicYearPreference_userId_tenantId_idx" ON "UserAcademicYearPreference"("userId", "tenantId");

ALTER TABLE "UserAcademicYearPreference" ADD CONSTRAINT "UserAcademicYearPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAcademicYearPreference" ADD CONSTRAINT "UserAcademicYearPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserAcademicYearPreference" ADD CONSTRAINT "UserAcademicYearPreference_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
