-- Emergency ROLLBACK for 20261006183500_backfill_course_sections (manual use only,
-- NOT auto-applied by `prisma migrate deploy`). Reverses the data backfill only.
-- To fully revert D1, afterwards run: ALTER TABLE "Lesson" DROP COLUMN "sectionId";
-- DROP TABLE "Section"; (only after confirming no code depends on them).

UPDATE "Lesson" SET "sectionId" = NULL, "updatedAt" = NOW()
WHERE "sectionId" IN (SELECT "id" FROM "Section" WHERE "title" = 'General');

DELETE FROM "Section" WHERE "title" = 'General';
