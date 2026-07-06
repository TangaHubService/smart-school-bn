-- Switch academy Program purchase unit from a single Course to a whole ClassRoom.
-- Existing courseId values do not map to ClassRoom ids, so they are cleared (dev/catalog data).

ALTER TABLE "Program" DROP CONSTRAINT IF EXISTS "Program_courseId_fkey";
ALTER TABLE "Program" RENAME COLUMN "courseId" TO "classRoomId";
UPDATE "Program" SET "classRoomId" = NULL;
ALTER TABLE "Program" ADD CONSTRAINT "Program_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Program_courseId_idx";
CREATE INDEX "Program_tenantId_classRoomId_idx" ON "Program"("tenantId", "classRoomId");

-- AcademySubscription.courseLimit now represents how many classes a plan can hold at once.
ALTER TABLE "AcademySubscription" RENAME COLUMN "courseLimit" TO "classLimit";
