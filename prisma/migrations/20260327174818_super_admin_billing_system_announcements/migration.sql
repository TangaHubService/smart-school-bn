-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SystemAnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SystemAnnouncementTarget" AS ENUM ('ALL_SCHOOLS', 'SPECIFIC_SCHOOLS', 'SPECIFIC_ROLES', 'SCHOOLS_AND_ROLES');

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "logoUrl" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxStudents" INTEGER,
    "maxStaff" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemAnnouncement" (
    "id" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SystemAnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "targetType" "SystemAnnouncementTarget" NOT NULL,
    "targetTenantIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetRoleNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSubscription_tenantId_key" ON "SchoolSubscription"("tenantId");

-- CreateIndex
CREATE INDEX "SchoolSubscription_planId_idx" ON "SchoolSubscription"("planId");

-- CreateIndex
CREATE INDEX "SchoolSubscription_status_idx" ON "SchoolSubscription"("status");

-- CreateIndex
CREATE INDEX "SchoolSubscription_currentPeriodEnd_idx" ON "SchoolSubscription"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "SystemAnnouncement_status_publishedAt_idx" ON "SystemAnnouncement"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "TimetableSlot_tenantId_academicYearId_termId_dayOfWeek_peri_idx" ON "TimetableSlot"("tenantId", "academicYearId", "termId", "dayOfWeek", "periodNumber");

-- AddForeignKey
ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolSubscription" ADD CONSTRAINT "SchoolSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemAnnouncement" ADD CONSTRAINT "SystemAnnouncement_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
