-- Program.section was added to prisma/schema.prisma in ec65e46 (2026-06-25) without a
-- matching migration ever being generated, leaving production's Program table without
-- the column (P2022 on prisma.program.findMany()).
ALTER TABLE "Program" ADD COLUMN "section" TEXT;
