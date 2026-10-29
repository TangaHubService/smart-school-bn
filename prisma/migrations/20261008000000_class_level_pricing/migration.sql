-- Pricing moves from Program level to ClassRoom level. Programs and legacy
-- per-program Payments are removed. Enrollments become class-based
-- (ClassEnrollment keyed by user + classRoom) so learners can take courses in
-- any class while a subscription plan controls duration.

-- 1. Class-level pricing fields
ALTER TABLE "ClassRoom" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ClassRoom" ADD COLUMN IF NOT EXISTS "durationDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ClassRoom" ADD COLUMN IF NOT EXISTS "thumbnail" TEXT;
ALTER TABLE "ClassRoom" ADD COLUMN IF NOT EXISTS "listedInPublicCatalog" BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS "ClassRoom_tenantId_listedInPublicCatalog_isActive_idx" ON "ClassRoom"("tenantId", "listedInPublicCatalog", "isActive");

-- Backfill class pricing from the linked program (latest program wins) so the
-- public catalog keeps showing the same price/thumbnail after the cutover.
UPDATE "ClassRoom" c SET
  "price" = p."price",
  "durationDays" = p."durationDays",
  "thumbnail" = COALESCE(p."thumbnail", c."thumbnail"),
  "listedInPublicCatalog" = p."listedInPublicCatalog"
FROM "Program" p
WHERE p."classRoomId" = c."id";

-- 2. Class-based enrollments (migrated from ProgramEnrollment)
CREATE TABLE IF NOT EXISTS "ClassEnrollment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "classRoomId" TEXT NOT NULL,
  "academySubscriptionId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "isTrial" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassEnrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ClassEnrollment_userId_classRoomId_key" ON "ClassEnrollment"("userId", "classRoomId");
CREATE INDEX IF NOT EXISTS "ClassEnrollment_tenantId_isActive_idx" ON "ClassEnrollment"("tenantId", "isActive");
CREATE INDEX IF NOT EXISTS "ClassEnrollment_tenantId_classRoomId_isActive_idx" ON "ClassEnrollment"("tenantId", "classRoomId", "isActive");
CREATE INDEX IF NOT EXISTS "ClassEnrollment_academySubscriptionId_idx" ON "ClassEnrollment"("academySubscriptionId");

-- Migrate: one row per (user, class). Keep the latest expiry, prefer non-trial.
-- Note: ids are md5-based uuids so the migration needs no extra extensions.
INSERT INTO "ClassEnrollment" ("id", "tenantId", "userId", "classRoomId", "academySubscriptionId", "expiresAt", "isActive", "isTrial", "createdAt", "updatedAt")
SELECT (md5(random()::text || clock_timestamp()::text)::uuid)::text, pe."tenantId", pe."userId", p."classRoomId", pe."academySubscriptionId", MAX(pe."expiresAt"), BOOL_OR(pe."isActive"), BOOL_AND(pe."isTrial"), MIN(pe."createdAt"), MAX(pe."updatedAt")
FROM "ProgramEnrollment" pe
JOIN "Program" p ON p."id" = pe."programId"
WHERE p."classRoomId" IS NOT NULL
GROUP BY pe."tenantId", pe."userId", p."classRoomId", pe."academySubscriptionId"
ON CONFLICT ("userId", "classRoomId") DO NOTHING;

-- 3. Drop legacy program tables
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClassEnrollment" ADD CONSTRAINT "ClassEnrollment_academySubscriptionId_fkey" FOREIGN KEY ("academySubscriptionId") REFERENCES "AcademySubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "Payment";
DROP TABLE IF EXISTS "ProgramEnrollment";
DROP TABLE IF EXISTS "Program";
