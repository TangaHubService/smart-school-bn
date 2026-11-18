-- Subjects may share a code as well as a name; keep a plain index for lookups.
DROP INDEX IF EXISTS "Subject_tenantId_code_key";
CREATE INDEX IF NOT EXISTS "Subject_tenantId_code_idx" ON "Subject"("tenantId", "code");
