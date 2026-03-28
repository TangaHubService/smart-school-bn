#!/usr/bin/env bash
# Clears P3009 for one migration: marks it rolled back in _prisma_migrations (no table drops).
# Then run: npm run prisma:migrate:deploy
#
# Usage (in container / server, DATABASE_URL set):
#   npm run prisma:migrate:resolve:rolled-back -- 20260306073000_sprint3_attendance
#
# Only use --rolled-back if the migration did NOT fully succeed. If the DB already matches
# the migration SQL and you only need to fix history, use prisma migrate resolve --applied <name>.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ $# -lt 1 ]; then
  echo "Usage: npm run prisma:migrate:resolve:rolled-back -- <migration_name>"
  echo "Example: npm run prisma:migrate:resolve:rolled-back -- 20260306073000_sprint3_attendance"
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL must be set."
  exit 1
fi

exec npx prisma migrate resolve --rolled-back "$1"
