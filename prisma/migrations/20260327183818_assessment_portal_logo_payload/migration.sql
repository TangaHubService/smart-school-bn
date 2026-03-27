-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssessmentQuestionType" ADD VALUE 'SHORT_ANSWER';
ALTER TYPE "AssessmentQuestionType" ADD VALUE 'ESSAY';

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "accessCode" TEXT,
ADD COLUMN     "portalAssignOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AssessmentStudentAssignment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentStudentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentStudentAssignment_tenantId_assessmentId_idx" ON "AssessmentStudentAssignment"("tenantId", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentStudentAssignment_tenantId_assessmentId_studentId_key" ON "AssessmentStudentAssignment"("tenantId", "assessmentId", "studentId");

-- AddForeignKey
ALTER TABLE "AssessmentStudentAssignment" ADD CONSTRAINT "AssessmentStudentAssignment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentStudentAssignment" ADD CONSTRAINT "AssessmentStudentAssignment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentStudentAssignment" ADD CONSTRAINT "AssessmentStudentAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
