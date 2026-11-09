-- Admin-defined level groups (e.g. "Lower Primary") for the public academy catalog.
-- Additive only: creates one table and one nullable column. Nothing is dropped.

-- AlterTable
ALTER TABLE "GradeLevel" ADD COLUMN     "levelGroupId" TEXT;

-- CreateTable
CREATE TABLE "LevelGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LevelGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LevelGroup_tenantId_isActive_rank_idx" ON "LevelGroup"("tenantId", "isActive", "rank");

-- CreateIndex
CREATE INDEX "GradeLevel_levelGroupId_idx" ON "GradeLevel"("levelGroupId");

-- AddForeignKey
ALTER TABLE "GradeLevel" ADD CONSTRAINT "GradeLevel_levelGroupId_fkey" FOREIGN KEY ("levelGroupId") REFERENCES "LevelGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LevelGroup" ADD CONSTRAINT "LevelGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

