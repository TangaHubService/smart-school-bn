-- Announcement.targetRoleNames and the AnnouncementAudience.SPECIFIC_ROLES enum value
-- were added to prisma/schema.prisma but no matching migration was ever generated
-- (only the unrelated SystemAnnouncement.targetRoleNames column was migrated). This
-- caused P2022 in production: "The column `Announcement.targetRoleNames` does not
-- exist in the current database." IF NOT EXISTS / conditional enum add make this safe
-- to apply regardless of what partial state, if any, production is already in.
ALTER TYPE "AnnouncementAudience" ADD VALUE IF NOT EXISTS 'SPECIFIC_ROLES';

ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "targetRoleNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
