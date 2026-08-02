#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UPSTREAM="$ROOT/infra/suno-api/upstream"
ENV_FILE="$ROOT/infra/suno-api/.env"

if [ ! -d "$UPSTREAM" ]; then
  echo "Cloning gcui-art/suno-api into infra/suno-api/upstream..."
  git clone --depth 1 https://github.com/gcui-art/suno-api.git "$UPSTREAM"
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/infra/suno-api/.env.example" "$ENV_FILE"
  echo "Created $ENV_FILE — add your SUNO_COOKIE and TWOCAPTCHA_KEY before starting."
fi

bash "$ROOT/scripts/patch-suno-api.sh"

echo "Done. Edit infra/suno-api/.env then run: npm run suno-api:up"
echo "Note: if your SUNO_COOKIE contains \$ characters, escape them as \$\$ in the .env file."
