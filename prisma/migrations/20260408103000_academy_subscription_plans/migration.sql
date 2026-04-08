-- CreateEnum
CREATE TYPE "AcademyPlanCode" AS ENUM ('TRIAL', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AcademySubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING_PAYMENT');

-- CreateTable
CREATE TABLE "AcademySubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planCode" "AcademyPlanCode" NOT NULL,
    "status" "AcademySubscriptionStatus" NOT NULL,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "courseLimit" INTEGER NOT NULL DEFAULT 3,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademySubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademySubscriptionPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "academySubscriptionId" TEXT,
    "planCode" "AcademyPlanCode" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT,
    "paypackRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademySubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ProgramEnrollment" ADD COLUMN "academySubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AcademySubscription_tenantId_userId_key" ON "AcademySubscription"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "AcademySubscription_tenantId_status_idx" ON "AcademySubscription"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AcademySubscription_userId_status_idx" ON "AcademySubscription"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AcademySubscriptionPayment_paypackRef_key" ON "AcademySubscriptionPayment"("paypackRef");

-- CreateIndex
CREATE INDEX "AcademySubscriptionPayment_tenantId_status_idx" ON "AcademySubscriptionPayment"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AcademySubscriptionPayment_userId_status_idx" ON "AcademySubscriptionPayment"("userId", "status");

-- CreateIndex
CREATE INDEX "AcademySubscriptionPayment_academySubscriptionId_idx" ON "AcademySubscriptionPayment"("academySubscriptionId");

-- CreateIndex
CREATE INDEX "ProgramEnrollment_academySubscriptionId_idx" ON "ProgramEnrollment"("academySubscriptionId");

-- AddForeignKey
ALTER TABLE "AcademySubscription" ADD CONSTRAINT "AcademySubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademySubscription" ADD CONSTRAINT "AcademySubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademySubscriptionPayment" ADD CONSTRAINT "AcademySubscriptionPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademySubscriptionPayment" ADD CONSTRAINT "AcademySubscriptionPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademySubscriptionPayment" ADD CONSTRAINT "AcademySubscriptionPayment_academySubscriptionId_fkey" FOREIGN KEY ("academySubscriptionId") REFERENCES "AcademySubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramEnrollment" ADD CONSTRAINT "ProgramEnrollment_academySubscriptionId_fkey" FOREIGN KEY ("academySubscriptionId") REFERENCES "AcademySubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
