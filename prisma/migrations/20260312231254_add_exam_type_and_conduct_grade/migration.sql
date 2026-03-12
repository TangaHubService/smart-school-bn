-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('CAT', 'EXAM');

-- AlterTable
ALTER TABLE "Exam" ADD COLUMN     "examType" "ExamType" NOT NULL DEFAULT 'EXAM';

-- CreateTable
CREATE TABLE "ConductGrade" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classRoomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "remark" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductGrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConductGrade_tenantId_termId_classRoomId_idx" ON "ConductGrade"("tenantId", "termId", "classRoomId");

-- CreateIndex
CREATE UNIQUE INDEX "ConductGrade_tenantId_termId_classRoomId_studentId_key" ON "ConductGrade"("tenantId", "termId", "classRoomId", "studentId");

-- AddForeignKey
ALTER TABLE "ConductGrade" ADD CONSTRAINT "ConductGrade_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductGrade" ADD CONSTRAINT "ConductGrade_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductGrade" ADD CONSTRAINT "ConductGrade_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductGrade" ADD CONSTRAINT "ConductGrade_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductGrade" ADD CONSTRAINT "ConductGrade_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductGrade" ADD CONSTRAINT "ConductGrade_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductGrade" ADD CONSTRAINT "ConductGrade_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
