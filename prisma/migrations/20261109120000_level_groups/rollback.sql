-- Manual rollback for 20261109120000_level_groups. Not run by Prisma.
-- Removes the level groups the admins created; grade levels stay intact.
ALTER TABLE "GradeLevel" DROP CONSTRAINT IF EXISTS "GradeLevel_levelGroupId_fkey";
DROP INDEX IF EXISTS "GradeLevel_levelGroupId_idx";
ALTER TABLE "GradeLevel" DROP COLUMN IF EXISTS "levelGroupId";
DROP TABLE IF EXISTS "LevelGroup";
