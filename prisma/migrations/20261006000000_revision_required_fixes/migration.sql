-- Revision Required: user identity fields, manual billing fields, help-desk tickets
-- Safe, additive-only migration. No drops, no data resets.

-- 1. User identification fields (Rev #5, #11)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sex" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasDisability" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "disabilityType" TEXT;

-- 2. Manual billing fields on invoices + payments (Rev #16–19)
ALTER TABLE "SubscriptionInvoice" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "SubscriptionInvoice" ADD COLUMN IF NOT EXISTS "paymentDate" TIMESTAMPTZ;
ALTER TABLE "SubscriptionInvoice" ADD COLUMN IF NOT EXISTS "reference" TEXT;
ALTER TABLE "SubscriptionInvoice" ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "SubscriptionInvoicePayment" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
ALTER TABLE "SubscriptionInvoicePayment" ADD COLUMN IF NOT EXISTS "reference" TEXT;

-- 3. Help-desk ticket system (Rev #4, #7)
-- NOTE: PostgreSQL has no CREATE TYPE IF NOT EXISTS, so guard with a DO block.
DO $$ BEGIN
  CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticketNumber" TEXT NOT NULL UNIQUE,
  "tenantId" TEXT,
  "createdByUserId" TEXT,
  "name" TEXT,
  "email" TEXT,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
  "assignedToUserId" TEXT,
  "resolvedAt" TIMESTAMPTZ,
  "closedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "SupportTicket_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SupportTicket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SupportTicket_tenantId_status_createdAt_idx" ON "SupportTicket"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_createdByUserId_status_idx" ON "SupportTicket"("createdByUserId", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_priority_createdAt_idx" ON "SupportTicket"("status", "priority", "createdAt");

CREATE TABLE IF NOT EXISTS "TicketReply" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticketId" TEXT NOT NULL,
  "tenantId" TEXT,
  "authorUserId" TEXT,
  "authorName" TEXT,
  "body" TEXT NOT NULL,
  "isStaffReply" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketReply_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TicketReply_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TicketReply_ticketId_createdAt_idx" ON "TicketReply"("ticketId", "createdAt");

CREATE TABLE IF NOT EXISTS "TicketAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticketId" TEXT NOT NULL,
  "replyId" TEXT,
  "fileAssetId" TEXT,
  "fileUrl" TEXT,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "TicketAttachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketAttachment_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "TicketReply"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketAttachment_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TicketAttachment_ticketId_createdAt_idx" ON "TicketAttachment"("ticketId", "createdAt");
