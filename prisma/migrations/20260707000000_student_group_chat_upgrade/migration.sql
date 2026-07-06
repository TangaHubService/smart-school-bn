-- Class chats scoped per academic year (a new cohort in the same physical classroom no
-- longer sees a previous year's messages), with reactions, replies, mentions, pinning,
-- moderation (soft delete), and read receipts.
--
-- StudentGroupChat/GroupChatMessage were never shipped in a prior migration (they only
-- existed via `prisma db push` in development), so this migration creates them from
-- scratch with their final shape instead of altering pre-existing tables.

CREATE TABLE "StudentGroupChat" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "classRoomId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentGroupChat_pkey" PRIMARY KEY ("id")
);

-- One conversation per class per academic year — a new cohort in the same physical
-- classroom does not see a previous year's messages.
CREATE UNIQUE INDEX "StudentGroupChat_tenantId_classRoomId_academicYearId_key" ON "StudentGroupChat"("tenantId", "classRoomId", "academicYearId");
CREATE INDEX "StudentGroupChat_tenantId_classRoomId_idx" ON "StudentGroupChat"("tenantId", "classRoomId");

ALTER TABLE "StudentGroupChat" ADD CONSTRAINT "StudentGroupChat_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentGroupChat" ADD CONSTRAINT "StudentGroupChat_classRoomId_fkey" FOREIGN KEY ("classRoomId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudentGroupChat" ADD CONSTRAINT "StudentGroupChat_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- GroupChatMessage: FileAsset attachment (consistent with lessons/assignments/announcements/
-- audits), replies, mentions, pinning, and moderation.
CREATE TABLE "GroupChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fileAssetId" TEXT,
    "replyToId" TEXT,
    "mentionedUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "isAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinnedAt" TIMESTAMP(3),
    "pinnedByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GroupChatMessage_chatId_createdAt_idx" ON "GroupChatMessage"("chatId", "createdAt");
CREATE INDEX "GroupChatMessage_chatId_isPinned_idx" ON "GroupChatMessage"("chatId", "isPinned");

ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "StudentGroupChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "GroupChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_pinnedByUserId_fkey" FOREIGN KEY ("pinnedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GroupChatMessage" ADD CONSTRAINT "GroupChatMessage_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
