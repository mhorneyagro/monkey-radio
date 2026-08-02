#!/usr/bin/env bash
# Sync local MP3 library to Cloudflare R2 (or any S3-compatible bucket).
#
# Prerequisites:
#   brew install awscli   # or apt install awscli
#
# Configure ~/.aws/credentials or export:
#   AWS_ACCESS_KEY_ID=...      # R2 API token access key
#   AWS_SECRET_ACCESS_KEY=...  # R2 API token secret
#   R2_BUCKET=monkey-radio-library
#   R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
#   LIBRARY_CDN_URL=https://library.yourdomain.com  # public CDN/custom domain URL
#
# Usage:
#   ./scripts/sync-library-to-r2.sh
#   ./scripts/sync-library-to-r2.sh ./data/library

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/load-env.sh
source "$ROOT/scripts/load-env.sh"
load_dotenv "$ROOT/.env"

LIBRARY_DIR="${1:-${LIBRARY_PATH:-./data/library}}"
BUCKET="${R2_BUCKET:?Set R2_BUCKET in .env}"
ENDPOINT="${R2_ENDPOINT:?Set R2_ENDPOINT in .env}"

if [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
  echo "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env (R2 API token credentials)."
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found. Install with: brew install awscli"
  exit 1
fi

if [ ! -d "$LIBRARY_DIR" ]; then
  echo "Library directory not found: $LIBRARY_DIR"
  exit 1
fi

echo "Syncing $LIBRARY_DIR → s3://$BUCKET/"
aws s3 sync "$LIBRARY_DIR" "s3://$BUCKET/" \
  --endpoint-url "$ENDPOINT" \
  --region auto \
  --exclude ".*" \
  --cache-control "public, max-age=31536000, immutable"

echo ""
echo "Done. Ensure LIBRARY_CDN_URL in .env matches your public bucket URL."
echo "Example: LIBRARY_CDN_URL=https://library.yourdomain.com"
echo ""
echo "Track file_path values in SQLite should match object keys, e.g.:"
echo "  ambient/track-name.mp3"
