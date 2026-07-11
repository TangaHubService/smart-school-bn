-- Student.hasDisability / Student.disabilityType were added to prisma/schema.prisma in
-- commit b91b963 (2026-06-26) without a matching migration ever being generated. Production
-- turned out to already have "hasDisability" (added out-of-band at some point, never
-- recorded in a migration), which made the original unconditional ADD COLUMN fail with
-- P3018. Using IF NOT EXISTS makes this safe to apply regardless of which of the two
-- columns, if either, is already present.
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "hasDisability" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Student" ADD COLUMN IF NOT EXISTS "disabilityType" TEXT;
