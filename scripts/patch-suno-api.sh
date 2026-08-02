#!/usr/bin/env bash
# Apply local fixes to gcui-art/suno-api after clone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUNO_API="$ROOT/infra/suno-api/upstream/src/lib/SunoApi.ts"

if [ ! -f "$SUNO_API" ]; then
  echo "suno-api upstream not found — run npm run suno-api:setup first"
  exit 1
fi

if grep -q 'sunoCookiePattern' "$SUNO_API"; then
  echo "suno-api patch already applied"
  exit 0
fi

python3 - "$SUNO_API" << 'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text()
old = """    const lax: 'Lax' | 'Strict' | 'None' = 'Lax';
    cookies.push({
      name: '__session',
      value: this.currentToken+'',
      domain: '.suno.com',
      path: '/',
      sameSite: lax
    });
    for (const key in this.cookies) {
      cookies.push({
        name: key,
        value: this.cookies[key]+'',
        domain: '.suno.com',
        path: '/',
        sameSite: lax
      })
    }"""

new = """    const lax: 'Lax' | 'Strict' | 'None' = 'Lax';
    const sunoCookiePattern = /^( __client|__session|ajs_anonymous_id)/;
    cookies.push({
      name: '__session',
      value: this.currentToken+'',
      domain: '.suno.com',
      path: '/',
      sameSite: lax,
      secure: true,
    });
    for (const key in this.cookies) {
      if (!sunoCookiePattern.test(key) || key === '__session') continue;
      cookies.push({
        name: key,
        value: this.cookies[key]+'',
        domain: '.suno.com',
        path: '/',
        sameSite: lax,
        secure: true,
      })
    }"""

new = new.replace("/^( __client", "/^(__client")

if old not in text:
    raise SystemExit("Could not find patch target in SunoApi.ts — upstream may have changed")

path.write_text(text.replace(old, new))
print("Applied suno-api browser cookie patch")
PY
