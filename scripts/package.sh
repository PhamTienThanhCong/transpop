#!/usr/bin/env bash
# TransPop — build the Chrome Web Store / Edge Add-ons upload:  dist/transpop-v<version>.zip
#
#   npm run package        (or: bash scripts/package.sh)
#
# Steps: build locales → run all checks → zip the CONTENTS of extension/ (manifest.json at the
# zip root, as the stores require) excluding OS junk, source maps and tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v node >/dev/null 2>&1 || { echo "✖ node is required (https://nodejs.org, v22+)" >&2; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "✖ zip is required (macOS: built in · Debian/Ubuntu: sudo apt install zip)" >&2; exit 1; }

echo "▶ Building locales"
node scripts/build-locales.mjs

echo
echo "▶ Running checks"
node scripts/check.mjs

VERSION="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("extension/manifest.json", "utf8")).version)')"
if [[ -z "$VERSION" ]]; then
  echo "✖ could not read version from extension/manifest.json" >&2
  exit 1
fi

DIST="$ROOT/dist"
OUT="$DIST/transpop-v$VERSION.zip"
mkdir -p "$DIST"
rm -f "$OUT"

echo
echo "▶ Packaging v$VERSION"
(
  cd extension
  zip -r -X -q -9 "$OUT" . \
    -x '*.DS_Store' \
    -x '.*' -x '*/.*' \
    -x '__MACOSX/*' -x '*/__MACOSX/*' \
    -x '*.map' \
    -x 'tests/*' -x '*/tests/*' -x '*.test.js' -x '*.test.mjs' -x '*.spec.js' \
    -x '*.zip' -x '*.pem' -x '*.log' -x 'Thumbs.db' -x '*/Thumbs.db'
)

# Sanity: manifest.json must be at the zip root.
if ! unzip -l "$OUT" | awk '{print $4}' | grep -qx 'manifest.json'; then
  echo "✖ manifest.json is not at the root of $OUT" >&2
  exit 1
fi

FILES="$(unzip -Z1 "$OUT" | grep -vc '/$' || true)"
BYTES="$(wc -c < "$OUT" | tr -d ' ')"
HUMAN="$(awk -v b="$BYTES" 'BEGIN { if (b >= 1048576) printf "%.2f MB", b/1048576; else printf "%.1f KB", b/1024 }')"
echo "✔ ${OUT#"$ROOT"/} — $HUMAN ($BYTES bytes, $FILES files)"
echo "  Next: upload it at https://chrome.google.com/webstore/devconsole (see docs/PUBLISHING.md)"
