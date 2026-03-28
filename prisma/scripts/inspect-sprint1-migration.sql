-- Inspect Prisma migration row for sprint1_setup_foundation (failed / stuck deploy).
-- Usage: psql "$DATABASE_URL" -f prisma/scripts/inspect-sprint1-migration.sql

SELECT migration_name, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = '20260306021000_sprint1_setup_foundation';
