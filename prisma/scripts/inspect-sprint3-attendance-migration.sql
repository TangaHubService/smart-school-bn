-- Inspect failed/partial migration row for sprint3 attendance (P3009 recovery).
SELECT migration_name, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '20260306073000_sprint3_attendance';
