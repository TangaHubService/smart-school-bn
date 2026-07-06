-- Introduce a real submit/review workflow for teacher lesson plans, replacing
-- the ad-hoc DRAFT/PUBLISHED/ARCHIVED status with DRAFT/SUBMITTED/APPROVED/
-- REJECTED/ARCHIVED. Existing PUBLISHED rows are treated as already-approved
-- (dev/catalog data, no production usage yet).
ALTER TYPE "LessonPlanStatus" RENAME TO "LessonPlanStatus_old";
CREATE TYPE "LessonPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ARCHIVED');

ALTER TABLE "TeacherLessonPlan" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TeacherLessonPlan" ALTER COLUMN "status" TYPE "LessonPlanStatus" USING (
  CASE "status"::text
    WHEN 'PUBLISHED' THEN 'APPROVED'
    ELSE "status"::text
  END
)::"LessonPlanStatus";
ALTER TABLE "TeacherLessonPlan" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "LessonPlanStatus_old";

-- Revision history: one row per create/update/submit/approve/reject/recommendation,
-- carrying a full content snapshot so past states can be reviewed later.
CREATE TYPE "LessonPlanRevisionAction" AS ENUM ('CREATED', 'UPDATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RECOMMENDATION');

CREATE TABLE "TeacherLessonPlanRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "LessonPlanRevisionAction" NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherLessonPlanRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeacherLessonPlanRevision_tenantId_planId_createdAt_idx" ON "TeacherLessonPlanRevision"("tenantId", "planId", "createdAt");

ALTER TABLE "TeacherLessonPlanRevision" ADD CONSTRAINT "TeacherLessonPlanRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherLessonPlanRevision" ADD CONSTRAINT "TeacherLessonPlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TeacherLessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeacherLessonPlanRevision" ADD CONSTRAINT "TeacherLessonPlanRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
