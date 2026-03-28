#!/usr/bin/env bash
# Run Prisma migrations (recommended). Requires DATABASE_URL.
# Usage: from repo root —  bash prisma/scripts/migrate-deploy.sh
#    or:  DATABASE_URL='postgresql://...' bash prisma/scripts/migrate-deploy.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: set DATABASE_URL (e.g. export DATABASE_URL='postgresql://user:pass@host:5432/db')"
  exit 1
fi

exec npx prisma migrate deploy
