-- Backfill for D1 (E-Running sections): one published "General" section per
-- course, then attach all unsectioned lessons to it in their existing order.
-- Idempotent: guarded by NOT EXISTS / IS NULL so re-runs and redeploys are safe.
-- New (manually created) sections default to draft; the backfilled "General"
-- section is published so existing published lessons stay visible to students.

INSERT INTO "Section" ("id", "tenantId", "courseId", "title", "sortOrder", "isPublished", "publishedAt", "createdByUserId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."tenantId", c."id", 'General', 0, true, NOW(), c."teacherUserId", NOW(), NOW()
FROM "Course" c
WHERE NOT EXISTS (SELECT 1 FROM "Section" s WHERE s."courseId" = c."id");

UPDATE "Lesson" l SET "sectionId" = s."id", "updatedAt" = NOW()
FROM "Section" s
WHERE l."courseId" = s."courseId"
  AND l."sectionId" IS NULL
  AND s."title" = 'General';
