-- Rollback is best-effort: dropped Program/Payment tables cannot be restored
-- with their data. This only removes the migration's additive changes.

DROP TABLE IF EXISTS "ClassEnrollment";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "listedInPublicCatalog";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "thumbnail";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "durationDays";
ALTER TABLE "ClassRoom" DROP COLUMN IF EXISTS "price";
