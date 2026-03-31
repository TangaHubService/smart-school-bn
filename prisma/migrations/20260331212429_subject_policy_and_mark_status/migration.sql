-- CreateEnum
CREATE TYPE "ExamAssessmentType" AS ENUM ('QUIZ', 'TEST', 'ASSIGNMENT', 'ORAL', 'PRACTICAL', 'PROJECT', 'MIDTERM', 'EXAM');

-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "assessmentType" "ExamAssessmentType";

-- AlterTable
ALTER TABLE "ExamMark" ADD COLUMN     "status" "MarkStatus" NOT NULL DEFAULT 'PRESENT',
ALTER COLUMN "marksObtained" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SubjectAssessmentPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classRoomId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "continuousWeight" INTEGER NOT NULL DEFAULT 40,
    "examWeight" INTEGER NOT NULL DEFAULT 60,
    "passMark" INTEGER NOT NULL DEFAULT 50,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubjectAssessmentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubjectAssessmentPolicy_tenantId_termId_classRoomId_idx" ON "SubjectAssessmentPolicy"("tenantId", "termId", "classRoomId");

-- CreateIndex
CREATE INDEX "SubjectAssessmentPolicy_tenantId_academicYearId_createdAt_idx" ON "SubjectAssessmentPolicy"("tenantId", "academicYearId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectAssessmentPolicy_tenantId_termId_classRoomId_subject_key" ON "SubjectAssessmentPolicy"("tenantId", "termId", "classRoomId", "subjectId");

-- AddForeignKey
ALTER TABLE "SubjectAssessmentPolicy" ADD CONSTRAINT "SubjectAssessmentPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssessmentPolicy" ADD CONSTRAINT "SubjectAssessmentPolicy_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssessmentPolicy" ADD CONSTRAINT "SubjectAssessmentPolicy_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssessmentPolicy" ADD CONSTRAINT "SubjectAssessmentPolicy_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssessmentPolicy" ADD CONSTRAINT "SubjectAssessmentPolicy_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssessmentPolicy" ADD CONSTRAINT "SubjectAssessmentPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectAssessmentPolicy" ADD CONSTRAINT "SubjectAssessmentPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
