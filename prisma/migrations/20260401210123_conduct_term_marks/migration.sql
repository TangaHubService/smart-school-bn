-- CreateTable
CREATE TABLE "ConductTermSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "totalMarks" INTEGER NOT NULL DEFAULT 100,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConductTermSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConductDeduction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "classRoomId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "pointsDeducted" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConductDeduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConductTermSetting_tenantId_termId_idx" ON "ConductTermSetting"("tenantId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "ConductTermSetting_tenantId_termId_key" ON "ConductTermSetting"("tenantId", "termId");

-- CreateIndex
CREATE INDEX "ConductDeduction_tenantId_studentId_termId_createdAt_idx" ON "ConductDeduction"("tenantId", "studentId", "termId", "createdAt");

-- CreateIndex
CREATE INDEX "ConductDeduction_tenantId_termId_classRoomId_idx" ON "ConductDeduction"("tenantId", "termId", "classRoomId");

-- AddForeignKey
ALTER TABLE "ConductTermSetting" ADD CONSTRAINT "ConductTermSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductTermSetting" ADD CONSTRAINT "ConductTermSetting_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductTermSetting" ADD CONSTRAINT "ConductTermSetting_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductDeduction" ADD CONSTRAINT "ConductDeduction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductDeduction" ADD CONSTRAINT "ConductDeduction_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductDeduction" ADD CONSTRAINT "ConductDeduction_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductDeduction" ADD CONSTRAINT "ConductDeduction_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductDeduction" ADD CONSTRAINT "ConductDeduction_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConductDeduction" ADD CONSTRAINT "ConductDeduction_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
