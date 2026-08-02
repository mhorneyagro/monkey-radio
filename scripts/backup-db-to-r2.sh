#!/usr/bin/env bash
# Upload SQLite database to R2 for Render bootstrap.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/load-env.sh"
load_dotenv "$ROOT/.env"

DB_PATH="${1:-${DATABASE_PATH:-./data/monkey-radio.db}}"
BUCKET="${R2_BUCKET:?Set R2_BUCKET in .env}"
ENDPOINT="${R2_ENDPOINT:?Set R2_ENDPOINT in .env}"
META_KEY="_meta/monkey-radio.db"

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  echo "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env"
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "Database not found: $DB_PATH"
  exit 1
fi

echo "Uploading $DB_PATH → s3://$BUCKET/$META_KEY"
aws s3 cp "$DB_PATH" "s3://$BUCKET/$META_KEY" \
  --endpoint-url "$ENDPOINT" \
  --region auto

echo "Done. Render will restore this on first boot if no local DB exists."
