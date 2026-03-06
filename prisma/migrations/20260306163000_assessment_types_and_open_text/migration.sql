CREATE TYPE "AssessmentType" AS ENUM ('GENERAL', 'OPENENDED', 'PSYCHOMETRIC', 'INTERVIEW');

DO $$
BEGIN
  ALTER TYPE "AssessmentQuestionType" ADD VALUE 'OPEN_TEXT';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Assessment"
ADD COLUMN "type" "AssessmentType" NOT NULL DEFAULT 'GENERAL';

ALTER TABLE "AssessmentAnswer"
ADD COLUMN "textResponse" TEXT;
