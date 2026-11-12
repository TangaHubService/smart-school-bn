-- Parents (and other readers) can acknowledge or reply to announcements.
CREATE TYPE "AnnouncementResponseType" AS ENUM ('ACKNOWLEDGE', 'REPLY');

CREATE TABLE "AnnouncementResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AnnouncementResponseType" NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnnouncementResponse_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnnouncementResponse_announcementId_createdAt_idx" ON "AnnouncementResponse"("announcementId", "createdAt");
CREATE INDEX "AnnouncementResponse_tenantId_userId_idx" ON "AnnouncementResponse"("tenantId", "userId");
ALTER TABLE "AnnouncementResponse" ADD CONSTRAINT "AnnouncementResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnnouncementResponse" ADD CONSTRAINT "AnnouncementResponse_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementResponse" ADD CONSTRAINT "AnnouncementResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
