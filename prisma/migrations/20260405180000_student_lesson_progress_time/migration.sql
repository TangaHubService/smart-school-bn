-- AlterTable
ALTER TABLE "StudentLessonProgress" ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "lastActivityAt" TIMESTAMP(3),
ADD COLUMN "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0;
