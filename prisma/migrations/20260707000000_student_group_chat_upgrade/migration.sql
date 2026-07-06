-- Scope class chats per academic year (a new cohort in the same physical classroom no
-- longer sees a previous year's messages), and add reactions, replies, mentions, pinning,
-- moderation (soft delete), and read receipts.

ALTER TABLE "StudentGroupChat" ADD COLUMN "academicYearId" TEXT;

-- Backfill existing chats to each tenant's current academic year (dev/catalog data — no
-- production usage yet), falling back to the most recent year if none is marked current.
UPDATE "StudentGroupChat" sgc
SET "academicYearId" = (
  SELECT ay.id FROM "AcademicYear" ay WHERE ay."tenantId" = sgc."tenantId" AND ay."isCurrent" = true LIMIT 1
);
UPDATE "StudentGroupChat" sgc
SET "academicYearId" = (
  SELECT ay.id FROM "AcademicYear" ay WHERE ay."tenantId" = sgc."tenantId" ORDER BY ay."startDate" DESC LIMIT 1
)
WHERE sgc."academicYearId" IS NULL;

ALTER TABLE "StudentGroupChat" ALTER COLUMN "academicYearId" SET NOT NULL;
ALTER TABLE "StudentGroupChat" ADD CONSTRAINT "StudentGroupChat_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "StudentGroupChat_tenantId_classRoomId_key";
CREATE UNIQUE INDEX "StudentGroupChat_tenantId_classRoomId_academicYearId_key" ON "StudentGroupChat"("tenantId", "classRoomId", "academicYearId");

-- GroupChatMessage: replace the bare fileUrl string with a proper FileAsset attachment
-- (consistent with lessons/assignments/announcements/audits), add replies, mentions,
-- pinning, and moderation.
ALTER TABLE "GroupChatMessage" DROP COLUMN "fileUrl";
ALTER TABLE "GroupChatMessage" DROP COLUMN "readAt";
ALTER TABLE "GroupChatMessage"
  ADD COLUMN "fileAssetId" TEXT,
  ADD COLUMN "replyToId" TEXT,
  ADD COLUMN "mentionedUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pinnedAt" TIMESTAMP(3),
  ADD COLUMN "pinnedByUserId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;

ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "GroupChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_pinnedByUserId_fkey" FOREIGN KEY ("pinnedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "GroupChatMessage_chatId_isPinned_idx" ON "GroupChatMessage"("chatId", "isPinned");

CREATE TABLE "GroupChatReaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupChatReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GroupChatReaction_messageId_userId_emoji_key" ON "GroupChatReaction"("messageId", "userId", "emoji");
CREATE INDEX "GroupChatReaction_messageId_idx" ON "GroupChatReaction"("messageId");

ALTER TABLE "GroupChatReaction" ADD CONSTRAINT "GroupChatReaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupChatReaction" ADD CONSTRAINT "GroupChatReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "GroupChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupChatReaction" ADD CONSTRAINT "GroupChatReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StudentGroupChatRead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentGroupChatRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudentGroupChatRead_chatId_userId_key" ON "StudentGroupChatRead"("chatId", "userId");
CREATE INDEX "StudentGroupChatRead_tenantId_userId_idx" ON "StudentGroupChatRead"("tenantId", "userId");

ALTER TABLE "StudentGroupChatRead" ADD CONSTRAINT "StudentGroupChatRead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentGroupChatRead" ADD CONSTRAINT "StudentGroupChatRead_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "StudentGroupChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudentGroupChatRead" ADD CONSTRAINT "StudentGroupChatRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
