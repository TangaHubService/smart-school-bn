-- Parents of schools created before announcements.my_read was added to the
-- PARENT role cannot see announcements. Add the permission to every existing
-- PARENT role that lacks it. Only adds; never removes. Safe to re-run.
UPDATE "Role"
SET "permissions" = "permissions" || '["announcements.my_read"]'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'PARENT'
  AND jsonb_typeof("permissions") = 'array'
  AND NOT ("permissions" ? 'announcements.my_read');
