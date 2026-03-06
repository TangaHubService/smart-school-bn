-- AlterTable
ALTER TABLE "AssessmentAttempt"
ADD COLUMN "manualScore" INTEGER,
ADD COLUMN "manualFeedback" TEXT,
ADD COLUMN "manuallyGradedAt" TIMESTAMP(3),
ADD COLUMN "manuallyGradedByUserId" TEXT;

-- AlterTable
ALTER TABLE "AssessmentAnswer"
ADD COLUMN "manualPointsAwarded" INTEGER;

-- CreateIndex
CREATE INDEX "AssessmentAttempt_tenantId_manuallyGradedByUserId_updatedAt_idx"
ON "AssessmentAttempt"("tenantId", "manuallyGradedByUserId", "updatedAt");

-- AddForeignKey
ALTER TABLE "AssessmentAttempt"
ADD CONSTRAINT "AssessmentAttempt_manuallyGradedByUserId_fkey"
FOREIGN KEY ("manuallyGradedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
