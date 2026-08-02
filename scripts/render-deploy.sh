#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Monkey Radio — Render deploy"
echo ""

if ! render whoami -o text 2>/dev/null | grep -q .; then
  echo "Run first: render login"
  exit 1
fi

render blueprints validate "$ROOT/render.yaml"
npm run render:env

SERVICE_NAME="${RENDER_SERVICE_NAME:-monkey-radio}"
SERVICE_ID="$(render services -o json 2>/dev/null | node -e "
  let raw = '';
  process.stdin.on('data', d => raw += d);
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(raw || '[]');
      const list = Array.isArray(data) ? data : (data.services ?? data.items ?? []);
      const name = process.argv[1];
      const match = list.find(s => (s.name || s.service?.name) === name);
      const id = match?.id || match?.service?.id;
      if (id) process.stdout.write(id);
    } catch {}
  });
" "$SERVICE_NAME" 2>/dev/null || true)"

if [ -n "$SERVICE_ID" ]; then
  echo ""
  echo "==> Service found: $SERVICE_NAME ($SERVICE_ID)"
  echo "Triggering deploy…"
  render deploys create "$SERVICE_ID" --confirm -o text
  echo ""
  echo "Monitor: render logs $SERVICE_ID"
  echo "After RTMP is flowing: npm run youtube:live-go"
  exit 0
fi

echo ""
echo "No Render service named '$SERVICE_NAME' yet."
echo ""
if [ ! -d .git ] || ! git rev-parse HEAD >/dev/null 2>&1; then
  echo "Initialize git and push to GitHub first:"
  echo "  git add -A && git commit -m 'Deploy Monkey Radio'"
  echo "  git remote add origin https://github.com/<you>/monkey-radio.git"
  echo "  git push -u origin main"
  echo ""
fi

echo "Create the service in Render Dashboard:"
echo "  1. New → Blueprint → connect your GitHub repo"
echo "  2. Apply render.yaml (Pro plan + 10GB disk)"
echo "  3. When prompted for secrets, paste ALL lines from .env.render"
echo "  4. Wait for deploy, then: npm run render:deploy -- --deploy"
echo ""
echo "Secrets file: $ROOT/.env.render"
