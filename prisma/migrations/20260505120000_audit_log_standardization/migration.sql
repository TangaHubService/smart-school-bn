-- CreateEnum
CREATE TYPE "AuditActionType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT');

-- CreateEnum
CREATE TYPE "AuditLogStatus" AS ENUM ('SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "RefreshToken"
ADD COLUMN "sessionId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog"
ADD COLUMN "actorName" TEXT,
ADD COLUMN "actorRole" TEXT,
ADD COLUMN "schoolName" TEXT,
ADD COLUMN "actionType" "AuditActionType",
ADD COLUMN "module" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "recordId" TEXT,
ADD COLUMN "device" TEXT,
ADD COLUMN "status" "AuditLogStatus",
ADD COLUMN "sessionId" TEXT,
ADD COLUMN "oldValue" JSONB,
ADD COLUMN "newValue" JSONB;

UPDATE "RefreshToken"
SET "sessionId" = "id"
WHERE "sessionId" IS NULL;

UPDATE "AuditLog"
SET
  "recordId" = COALESCE("recordId", "entityId"),
  "device" = COALESCE("device", "userAgent"),
  "status" = CASE
    WHEN "event" IN ('AUTH_LOGIN_FAILED', 'ACCESS_DENIED') THEN 'FAILED'::"AuditLogStatus"
    ELSE 'SUCCESS'::"AuditLogStatus"
  END,
  "actionType" = CASE
    WHEN "event" = 'AUTH_LOGOUT' THEN 'LOGOUT'::"AuditActionType"
    WHEN "event" IN ('AUTH_LOGIN_SUCCESS', 'AUTH_LOGIN_FAILED') THEN 'LOGIN'::"AuditActionType"
    WHEN "event" LIKE '%_DELETED' OR "event" LIKE '%_REVOKED' THEN 'DELETE'::"AuditActionType"
    WHEN "event" LIKE '%_CREATED'
      OR "event" LIKE '%_ADDED'
      OR "event" LIKE '%_ASSIGNED'
      OR "event" LIKE '%_LINKED%'
      OR "event" LIKE '%_REQUESTED'
      OR "event" LIKE '%_COMMITTED'
      OR "event" LIKE '%_STARTED'
      OR "event" LIKE '%_GRANTED' THEN 'CREATE'::"AuditActionType"
    ELSE 'UPDATE'::"AuditActionType"
  END,
  "module" = CASE
    WHEN "event" LIKE 'AUTH_%' OR "event" LIKE 'USER_PASSWORD_%' THEN 'Authentication'
    WHEN "event" LIKE 'TENANT_%' THEN 'Tenants'
    WHEN "event" LIKE 'SCHOOL_%' THEN 'Schools'
    WHEN "event" LIKE 'STAFF_%' THEN 'Staff'
    WHEN "event" LIKE 'STUDENT_%' THEN 'Students'
    WHEN "event" LIKE 'PARENT_%' THEN 'Parents'
    WHEN "event" LIKE 'ATTENDANCE_%' THEN 'Attendance'
    WHEN "event" LIKE 'CONDUCT_%' THEN 'Conduct'
    WHEN "event" LIKE 'ASSESSMENT_%' THEN 'Assessments'
    WHEN "event" LIKE 'EXAM_%'
      OR "event" LIKE 'RESULTS_%'
      OR "event" LIKE 'REPORT_CARD_%'
      OR "event" LIKE 'GRADING_SCHEME_%' THEN 'Exams'
    WHEN "event" LIKE 'COURSE_%'
      OR "event" LIKE 'LESSON_%'
      OR "event" LIKE 'ASSIGNMENT_%'
      OR "event" LIKE 'SUBMISSION_%' THEN 'Learning'
    WHEN "event" LIKE 'GOV_%' THEN 'Government'
    WHEN "event" LIKE 'SUBSCRIPTION_%' OR "event" LIKE 'ACADEMY_%' THEN 'Finance'
    WHEN "event" LIKE 'SYSTEM_ANNOUNCEMENT_%' THEN 'System Announcements'
    WHEN "event" LIKE 'ACCESS_%' THEN 'Security'
    ELSE COALESCE("entity", 'General')
  END,
  "description" = COALESCE(
    "description",
    INITCAP(REPLACE(LOWER("event"), '_', ' '))
  );

UPDATE "AuditLog" AS a
SET "actorName" = NULLIF(TRIM(COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", '')), '')
FROM "User" AS u
WHERE a."actorUserId" = u."id"
  AND a."actorName" IS NULL;

UPDATE "AuditLog" AS a
SET "actorRole" = (
  SELECT r."name"
  FROM "UserRole" ur
  INNER JOIN "Role" r
    ON r."id" = ur."roleId"
  WHERE ur."userId" = a."actorUserId"
  ORDER BY
    CASE r."name"
      WHEN 'SUPER_ADMIN' THEN 1
      WHEN 'SCHOOL_ADMIN' THEN 2
      WHEN 'GOV_AUDITOR' THEN 3
      WHEN 'ACCOUNTANT' THEN 4
      WHEN 'TEACHER' THEN 5
      WHEN 'STUDENT' THEN 6
      WHEN 'PARENT' THEN 7
      WHEN 'PUBLIC_LEARNER' THEN 8
      ELSE 99
    END,
    r."name" ASC
  LIMIT 1
)
WHERE a."actorUserId" IS NOT NULL
  AND a."actorRole" IS NULL;

UPDATE "AuditLog" AS a
SET "schoolName" = COALESCE(s."displayName", t."name")
FROM "Tenant" AS t
LEFT JOIN "School" AS s
  ON s."tenantId" = t."id"
WHERE a."tenantId" = t."id"
  AND a."schoolName" IS NULL;

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actorUserId_createdAt_idx" ON "AuditLog"("tenantId", "actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actorRole_createdAt_idx" ON "AuditLog"("tenantId", "actorRole", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_module_createdAt_idx" ON "AuditLog"("tenantId", "module", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_actionType_createdAt_idx" ON "AuditLog"("tenantId", "actionType", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_status_createdAt_idx" ON "AuditLog"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_sessionId_idx" ON "AuditLog"("sessionId");
