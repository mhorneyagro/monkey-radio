#!/usr/bin/env bash
# Create Render service with env vars from .env.render
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT/.env.render}"
REPO="${RENDER_REPO:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE — run: npm run render:env"
  exit 1
fi

if [ -z "$REPO" ]; then
  REPO="$(git -C "$ROOT" remote get-url origin 2>/dev/null || true)"
fi

if [ -z "$REPO" ]; then
  echo "Set RENDER_REPO or add git remote origin"
  exit 1
fi

ARGS=(
  services create
  --confirm
  --name monkey-radio
  --type web_service
  --runtime docker
  --repo "$REPO"
  --branch main
  --region frankfurt
  --plan pro
  --health-check-path /health
  --start-command all
  -o json
)

# Non-secret defaults from render.yaml env group
DEFAULTS=(
  NODE_ENV=production
  CHAT_PROVIDER=youtube
  DEFAULT_GENRE=lofi
  MIN_LIBRARY_PER_GENRE=1
  AVOID_REPLAY_LIMIT=50
  CROSSFADE_SEC=5
  MIN_TRACKS_BEFORE_DJ=1
  DJ_MIN_INTERVAL_SEC=120
  DJ_PREP_LEAD_SEC=45
  CHAT_POLL_INTERVAL_MS=5000
  CHAT_WINDOW_MS=300000
  BROADCAST_STALE_SEC=300
  LLM_MODEL=gpt-4o-mini
  ELEVENLABS_MODEL=eleven_turbo_v2_5
  DASHBOARD_URL=http://localhost:5400
  DISPLAY=:99
  STREAM_DISPLAY=:99
  STREAM_PULSE_MONITOR=stream_sink.monitor
  DATABASE_PATH=/app/data/monkey-radio.db
  LIBRARY_PATH=/app/data/library
  DJ_PATH=/app/data/dj
)

for pair in "${DEFAULTS[@]}"; do
  ARGS+=(--env-var "$pair")
done

while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%$'\r'}"
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  [[ "$line" != *=* ]] && continue
  ARGS+=(--env-var "$line")
done < "$ENV_FILE"

echo "Creating Render service monkey-radio from $REPO"
render "${ARGS[@]}"
