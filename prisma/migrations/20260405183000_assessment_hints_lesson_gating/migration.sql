-- AlterTable
ALTER TABLE "AssessmentQuestion" ADD COLUMN "hint" TEXT,
ADD COLUMN "remedialLessonId" TEXT;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN "mustPassAssessmentId" TEXT;

-- CreateIndex
CREATE INDEX "Lesson_mustPassAssessmentId_idx" ON "Lesson"("mustPassAssessmentId");

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_remedialLessonId_fkey" FOREIGN KEY ("remedialLessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_mustPassAssessmentId_fkey" FOREIGN KEY ("mustPassAssessmentId") REFERENCES "Assessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
