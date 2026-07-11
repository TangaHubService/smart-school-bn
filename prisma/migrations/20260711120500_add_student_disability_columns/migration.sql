-- Student.hasDisability / Student.disabilityType were added to prisma/schema.prisma in
-- commit b91b963 (2026-06-26) without a matching migration ever being generated, leaving
-- production's Student table without these columns (same drift class as Program.section).
ALTER TABLE "Student" ADD COLUMN "hasDisability" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Student" ADD COLUMN "disabilityType" TEXT;
