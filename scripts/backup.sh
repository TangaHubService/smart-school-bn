#!/usr/bin/env bash
set -euo pipefail

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

OUTPUT_FILE="$BACKUP_DIR/smart_school_$TIMESTAMP.dump"

echo "Creating backup at $OUTPUT_FILE"
pg_dump "$DATABASE_URL" -Fc -f "$OUTPUT_FILE"

echo "Backup created successfully"
