-- AlterTable
ALTER TABLE "TimetableSlot" ADD COLUMN IF NOT EXISTS "subjectId" TEXT;

-- AlterTable
ALTER TABLE "TimetableSlot" ALTER COLUMN "courseId" DROP NOT NULL;