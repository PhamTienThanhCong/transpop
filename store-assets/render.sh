#!/usr/bin/env bash
# Re-render every TransPop PNG (extension icons + Chrome Web Store graphics) from the SVG sources.
#
#   bash store-assets/render.sh
#
# Requires rsvg-convert (librsvg):  macOS: brew install librsvg   Debian/Ubuntu: apt install librsvg2-bin
#
# Sources:
#   extension/icons/logo.svg           master icon (48px, 128px, 512px preview)
#   store-assets/src/icon-16.svg       pixel-snapped simplified icon for 16×16
#   store-assets/src/icon-32.svg       pixel-snapped simplified icon for 32×32
#   store-assets/src/promo-*.svg       promo tiles (text rendered with local system fonts)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ICONS="$ROOT/extension/icons"
ASSETS="$ROOT/store-assets"
SRC="$ASSETS/src"

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "✖ rsvg-convert not found (brew install librsvg / apt install librsvg2-bin)" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# render_padded <svg 0..128> <output px> <padding px> <out.png>
# Shrinks the 128-unit artwork so it is surrounded by <padding> transparent pixels.
render_padded() {
  local svg="$1" size="$2" pad="$3" out="$4"
  local vb
  vb="$(node -e '
    const [size, pad] = process.argv.slice(1).map(Number);
    const box = (128 * size) / (size - 2 * pad);
    const off = -(box - 128) / 2;
    const f = (n) => +n.toFixed(4);
    process.stdout.write(`${f(off)} ${f(off)} ${f(box)} ${f(box)}`);
  ' "$size" "$pad")"
  sed -E "s/viewBox=\"0 0 128 128\"/viewBox=\"$vb\"/" "$svg" > "$TMP/padded.svg"
  rsvg-convert -w "$size" -h "$size" "$TMP/padded.svg" -o "$out"
}

echo "• extension icons"
rsvg-convert -w 16 -h 16 "$SRC/icon-16.svg" -o "$ICONS/icon16.png"
rsvg-convert -w 32 -h 32 "$SRC/icon-32.svg" -o "$ICONS/icon32.png"
render_padded "$ICONS/logo.svg" 48 2 "$ICONS/icon48.png"
# Chrome Web Store guidance: 128×128 canvas, 96×96 artwork, 16px transparent padding.
render_padded "$ICONS/logo.svg" 128 16 "$ICONS/icon128.png"

echo "• store assets"
cp "$ICONS/icon128.png" "$ASSETS/store-icon-128.png"
rsvg-convert -w 512 -h 512 "$ICONS/logo.svg" -o "$ASSETS/logo-512.png"
rsvg-convert -w 440 -h 280 "$SRC/promo-small-440x280.svg" -o "$ASSETS/promo-small-440x280.png"
rsvg-convert -w 1400 -h 560 "$SRC/promo-marquee-1400x560.svg" -o "$ASSETS/promo-marquee-1400x560.png"

for f in "$ICONS"/icon*.png "$ASSETS"/*.png; do
  printf '  ✔ %-60s %s\n' "${f#"$ROOT"/}" "$(wc -c < "$f" | tr -d ' ') bytes"
done
