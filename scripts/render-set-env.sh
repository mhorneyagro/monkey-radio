#!/usr/bin/env bash
# Push env vars to an existing Render service (service-level overrides).
set -euo pipefail

SERVICE_ID="${RENDER_SERVICE_ID:-srv-d9nn3k67bikc73c8tio0}"
CLI_CONFIG="${RENDER_CLI_CONFIG:-$HOME/.render/cli.yaml}"

if [ ! -f "$CLI_CONFIG" ]; then
  echo "Missing Render CLI config at $CLI_CONFIG — run: render login"
  exit 1
fi

API_KEY="$(grep -E '^\s+key: rnd_' "$CLI_CONFIG" | awk '{print $2}' | head -1)"
if [ -z "$API_KEY" ]; then
  echo "Could not read Render API key from $CLI_CONFIG"
  exit 1
fi

set_env() {
  local key="$1"
  local value="$2"
  local encoded_key
  encoded_key="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$key")"
  echo "→ $key=$value"
  curl -sS -X PUT \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"value\": \"$value\"}" \
    "https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${encoded_key}" \
    | node -e "
      let raw=''; process.stdin.on('data',d=>raw+=d); process.stdin.on('end',()=>{
        try {
          const data=JSON.parse(raw);
          if (data.message && !data.envVar) { console.error('API error:', data.message); process.exit(1); }
          console.log('  ok');
        } catch { console.log('  ok'); }
      });
    "
}

echo "Setting env vars on $SERVICE_ID"
set_env CHAT_POLL_INTERVAL_MS 15000
set_env YOUTUBE_ANNOUNCE_TRACKS_IN_CHAT false
set_env YOUTUBE_UPDATE_LIVE_DESCRIPTION false
echo "Done."
