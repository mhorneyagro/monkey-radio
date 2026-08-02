#!/usr/bin/env bash
# Prepare Monkey Radio for Render production deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/load-env.sh"
load_dotenv "$ROOT/.env"

fail=0

check_var() {
  local key="$1"
  local label="${2:-$key}"
  local value
  value="$(eval "echo \${${key}:-}")"
  if [ -z "$value" ]; then
    echo "  ✗ $label"
    fail=1
  else
    echo "  ✓ $label"
  fi
}

echo "==> Checking production prerequisites"
echo ""
echo "CDN & library:"
check_var LIBRARY_CDN_URL
check_var R2_BUCKET
check_var AWS_ACCESS_KEY_ID "R2 upload credentials"

echo ""
echo "AI:"
check_var OPENAI_API_KEY
check_var ELEVENLABS_API_KEY
check_var ELEVENLABS_VOICE_ID

echo ""
echo "YouTube Live (required for stream):"
check_var YOUTUBE_RTMP_URL
check_var YOUTUBE_STREAM_KEY
check_var YOUTUBE_API_KEY "YouTube Data API key (for chat)"

if [ -z "${YOUTUBE_BROADCAST_ID:-}" ]; then
  echo "  ✗ YOUTUBE_BROADCAST_ID (run: npm run youtube:live-create)"
  fail=1
else
  echo "  ✓ YOUTUBE_BROADCAST_ID"
fi

echo ""
echo "Dashboard:"
if [ -z "${ADMIN_API_KEY:-}" ]; then
  NEW_KEY="$(openssl rand -hex 24)"
  echo "  → Generating ADMIN_API_KEY"
  if grep -q '^ADMIN_API_KEY=' "$ROOT/.env"; then
    sed -i '' "s/^ADMIN_API_KEY=.*/ADMIN_API_KEY=$NEW_KEY/" "$ROOT/.env" 2>/dev/null || \
      sed -i "s/^ADMIN_API_KEY=.*/ADMIN_API_KEY=$NEW_KEY/" "$ROOT/.env"
  else
    echo "ADMIN_API_KEY=$NEW_KEY" >> "$ROOT/.env"
  fi
  load_dotenv "$ROOT/.env"
  echo "  ✓ ADMIN_API_KEY (saved to .env)"
else
  echo "  ✓ ADMIN_API_KEY"
fi

if [ -z "${YOUTUBE_RTMP_URL:-}" ] || [ -z "${YOUTUBE_STREAM_KEY:-}" ]; then
  echo ""
  echo "YouTube Live setup (one-time, requires browser):"
  echo "  1. npm run youtube:live-auth     # re-authorize with live streaming scopes"
  echo "  2. npm run youtube:live-create   # prints RTMP URL + stream key → add to .env"
  echo "  3. Get YOUTUBE_API_KEY from Google Cloud Console → YouTube Data API v3"
fi

echo ""
echo "==> Syncing assets to R2"
npm run library:sync-cdn
npm run db:backup-r2

echo ""
echo "==> Building Render env file"
npm run render:env

echo ""
if [ "$fail" -ne 0 ]; then
  echo "Fix missing items above, then re-run: npm run production:prepare"
  exit 1
fi

echo "Ready to deploy. Next:"
echo "  render login"
echo "  npm run render:deploy"
