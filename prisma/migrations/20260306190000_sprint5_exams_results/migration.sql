CREATE TYPE "ResultSnapshotStatus" AS ENUM ('LOCKED', 'PUBLISHED');

CREATE TABLE "GradingScheme" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "description" TEXT,
  "rules" JSONB NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GradingScheme_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Exam" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "classRoomId" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "gradingSchemeId" TEXT NOT NULL,
  "teacherUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "totalMarks" INTEGER NOT NULL DEFAULT 100,
  "weight" INTEGER NOT NULL DEFAULT 100,
  "examDate" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExamMark" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "examId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "marksObtained" INTEGER NOT NULL,
  "enteredByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExamMark_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResultSnapshot" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "academicYearId" TEXT NOT NULL,
  "termId" TEXT NOT NULL,
  "classRoomId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "gradingSchemeId" TEXT NOT NULL,
  "gradingSchemeVersion" INTEGER NOT NULL,
  "status" "ResultSnapshotStatus" NOT NULL DEFAULT 'LOCKED',
  "payload" JSONB NOT NULL,
  "lockedAt" TIMESTAMP(3) NOT NULL,
  "lockedByUserId" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "publishedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ResultSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GradingScheme_tenantId_name_version_key" ON "GradingScheme"("tenantId", "name", "version");
CREATE INDEX "GradingScheme_tenantId_isDefault_isActive_idx" ON "GradingScheme"("tenantId", "isDefault", "isActive");
CREATE INDEX "GradingScheme_tenantId_createdAt_idx" ON "GradingScheme"("tenantId", "createdAt");

CREATE UNIQUE INDEX "Exam_tenantId_termId_classRoomId_subjectId_name_key" ON "Exam"("tenantId", "termId", "classRoomId", "subjectId", "name");
CREATE INDEX "Exam_tenantId_termId_classRoomId_subjectId_idx" ON "Exam"("tenantId", "termId", "classRoomId", "subjectId");
CREATE INDEX "Exam_tenantId_teacherUserId_createdAt_idx" ON "Exam"("tenantId", "teacherUserId", "createdAt");
CREATE INDEX "Exam_tenantId_gradingSchemeId_idx" ON "Exam"("tenantId", "gradingSchemeId");

CREATE UNIQUE INDEX "ExamMark_tenantId_examId_studentId_key" ON "ExamMark"("tenantId", "examId", "studentId");
CREATE INDEX "ExamMark_tenantId_examId_updatedAt_idx" ON "ExamMark"("tenantId", "examId", "updatedAt");
CREATE INDEX "ExamMark_tenantId_studentId_updatedAt_idx" ON "ExamMark"("tenantId", "studentId", "updatedAt");

CREATE UNIQUE INDEX "ResultSnapshot_tenantId_termId_classRoomId_studentId_key" ON "ResultSnapshot"("tenantId", "termId", "classRoomId", "studentId");
CREATE INDEX "ResultSnapshot_tenantId_termId_classRoomId_status_idx" ON "ResultSnapshot"("tenantId", "termId", "classRoomId", "status");
CREATE INDEX "ResultSnapshot_tenantId_studentId_publishedAt_idx" ON "ResultSnapshot"("tenantId", "studentId", "publishedAt");

ALTER TABLE "GradingScheme"
ADD CONSTRAINT "GradingScheme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GradingScheme"
ADD CONSTRAINT "GradingScheme_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GradingScheme"
ADD CONSTRAINT "GradingScheme_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_teacherUserId_fkey" FOREIGN KEY ("teacherUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Exam"
ADD CONSTRAINT "Exam_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExamMark"
ADD CONSTRAINT "ExamMark_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamMark"
ADD CONSTRAINT "ExamMark_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamMark"
ADD CONSTRAINT "ExamMark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamMark"
ADD CONSTRAINT "ExamMark_enteredByUserId_fkey" FOREIGN KEY ("enteredByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamMark"
ADD CONSTRAINT "ExamMark_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResultSnapshot"
ADD CONSTRAINT "ResultSnapshot_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
