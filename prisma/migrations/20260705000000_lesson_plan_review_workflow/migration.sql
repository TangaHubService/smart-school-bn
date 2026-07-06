-- Introduce a real submit/review workflow for teacher lesson plans, using
-- DRAFT/SUBMITTED/APPROVED/REJECTED/ARCHIVED status. TeacherLessonPlan was
-- never shipped in a prior migration (it only existed via `prisma db push`
-- in development), so this migration creates it and its enum from scratch
-- with the final status set, instead of altering a pre-existing type/table.
CREATE TYPE "LessonPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ARCHIVED');

CREATE TABLE "TeacherLessonPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teacherUserId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "classRoomId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objectives" TEXT,
    "materials" TEXT,
    "activities" TEXT,
    "assessment" TEXT,
    "feedback" TEXT,
    "status" "LessonPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "weekNumber" INTEGER,
    "durationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherLessonPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherLessonPlan_tenantId_teacherUserId_classRoomId_subje_key" ON "TeacherLessonPlan"("tenantId", "teacherUserId", "classRoomId", "subjectId", "weekNumber");
CREATE INDEX "TeacherLessonPlan_tenantId_teacherUserId_academicYearId_idx" ON "TeacherLessonPlan"("tenantId", "teacherUserId", "academicYearId");
CREATE INDEX "TeacherLessonPlan_tenantId_classRoomId_subjectId_idx" ON "TeacherLessonPlan"("tenantId", "classRoomId", "subjectId");

ALTER TABLE "TeacherLessonPlan" ADD CONSTRAINT "TeacherLessonPlan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherLessonPlan" ADD CONSTRAINT "TeacherLessonPlan_teacherUserId_fkey" FOREIGN KEY ("teacherUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherLessonPlan" ADD CONSTRAINT "TeacherLessonPlan_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherLessonPlan" ADD CONSTRAINT "TeacherLessonPlan_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TeacherLessonPlan" ADD CONSTRAINT "TeacherLessonPlan_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
