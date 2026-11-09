-- Rollback is best-effort: the legacy Program/Payment tables are kept by the
-- migration, so this only removes its additive changes.

DROP TABLE IF EXISTS "ClassEnrollment";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "listedInPublicCatalog";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "thumbnail";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "durationDays";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "price";
