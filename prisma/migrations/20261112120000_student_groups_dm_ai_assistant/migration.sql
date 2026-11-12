-- Student group chats + direct messages, and the AI study assistant.

-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('CLASS', 'GROUP', 'DIRECT');
CREATE TYPE "ChatMemberRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- AlterTable: existing rows are class chats.
ALTER TABLE "StudentGroupChat"
  ADD COLUMN "type" "ChatType" NOT NULL DEFAULT 'CLASS',
  ADD COLUMN "description" TEXT,
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "directKey" TEXT,
  ADD COLUMN "lastMessageAt" TIMESTAMP(3),
  ALTER COLUMN "classRoomId" DROP NOT NULL,
  ALTER COLUMN "academicYearId" DROP NOT NULL;

UPDATE "StudentGroupChat" c
SET "lastMessageAt" = m.last
FROM (SELECT "chatId", MAX("createdAt") AS last FROM "GroupChatMessage" GROUP BY "chatId") m
WHERE m."chatId" = c."id";

CREATE UNIQUE INDEX "StudentGroupChat_directKey_key" ON "StudentGroupChat"("directKey");
CREATE INDEX "StudentGroupChat_tenantId_type_idx" ON "StudentGroupChat"("tenantId", "type");
ALTER TABLE "StudentGroupChat" ADD CONSTRAINT "StudentGroupChat_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ChatMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatMember_chatId_userId_key" ON "ChatMember"("chatId", "userId");
CREATE INDEX "ChatMember_tenantId_userId_idx" ON "ChatMember"("tenantId", "userId");
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "StudentGroupChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiConversation_tenantId_userId_updatedAt_idx" ON "AiConversation"("tenantId", "userId", "updatedAt");
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
