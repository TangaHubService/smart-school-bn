#!/usr/bin/env bash
# Apply each prisma/migrations/*/migration.sql in order with psql (emergency / DBA).
# Prefer: npx prisma migrate deploy  (updates _prisma_migrations correctly).
#
# After using this, Prisma history may be wrong. Typical recovery:
#   1) Fix failed row: npx prisma migrate resolve --rolled-back <name>
#   2) npx prisma migrate deploy
#
# Do NOT use this on a healthy DB that already tracks migrations unless you know what you are doing.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS="$ROOT/prisma/migrations"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: set DATABASE_URL"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql not found. Install PostgreSQL client."
  exit 1
fi

while IFS= read -r dir; do
  sql="$dir/migration.sql"
  if [ -f "$sql" ]; then
    echo ">>> $sql"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$sql"
  fi
done < <(find "$MIGRATIONS" -mindepth 1 -maxdepth 1 -type d -name '2*' | LC_ALL=C sort)

echo "Done. If Prisma still reports drift, run: npx prisma migrate deploy (after resolving any failed rows)."
