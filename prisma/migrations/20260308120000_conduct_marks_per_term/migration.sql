-- CreateEnum
CREATE TYPE "ConductMarkMethod" AS ENUM ('MANUAL', 'DEDUCT');

-- AlterTable
ALTER TABLE "ConductIncident"
ADD COLUMN "termId" TEXT,
ADD COLUMN "deductionPoints" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ConductFeedback"
ADD COLUMN "conductMarkId" TEXT,
ALTER COLUMN "incidentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ConductMark" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "maxScore" INTEGER NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "computedFromIncidents" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedByUserId" TEXT,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConductConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "method" "ConductMarkMethod" NOT NULL DEFAULT 'MANUAL',
    "maxScore" INTEGER NOT NULL DEFAULT 20,
    "deductionRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConductIncident_tenantId_termId_occurredAt_idx" ON "ConductIncident"("tenantId", "termId", "occurredAt");

-- CreateIndex
CREATE INDEX "ConductFeedback_tenantId_conductMarkId_createdAt_idx" ON "ConductFeedback"("tenantId", "conductMarkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConductMark_tenantId_studentId_termId_key" ON "ConductMark"("tenantId", "studentId", "termId");

-- CreateIndex
CREATE INDEX "ConductMark_tenantId_termId_isLocked_idx" ON "ConductMark"("tenantId", "termId", "isLocked");

-- CreateIndex
CREATE INDEX "ConductMark_tenantId_studentId_updatedAt_idx" ON "ConductMark"("tenantId", "studentId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConductConfig_tenantId_key" ON "ConductConfig"("tenantId");

-- AddConstraint
ALTER TABLE "ConductMark"
ADD CONSTRAINT "ConductMark_score_range_check" CHECK ("score" >= 0 AND "maxScore" > 0 AND "score" <= "maxScore");

-- AddConstraint
ALTER TABLE "ConductFeedback"
ADD CONSTRAINT "ConductFeedback_target_check" CHECK (
  (CASE WHEN "incidentId" IS NULL THEN 0 ELSE 1 END) +
  (CASE WHEN "conductMarkId" IS NULL THEN 0 ELSE 1 END) = 1
);

-- AddForeignKey
ALTER TABLE "ConductIncident"
ADD CONSTRAINT "ConductIncident_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductFeedback"
ADD CONSTRAINT "ConductFeedback_conductMarkId_fkey" FOREIGN KEY ("conductMarkId") REFERENCES "ConductMark"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductMark"
ADD CONSTRAINT "ConductMark_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductMark"
ADD CONSTRAINT "ConductMark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductMark"
ADD CONSTRAINT "ConductMark_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductMark"
ADD CONSTRAINT "ConductMark_lockedByUserId_fkey" FOREIGN KEY ("lockedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductMark"
ADD CONSTRAINT "ConductMark_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductConfig"
ADD CONSTRAINT "ConductConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
