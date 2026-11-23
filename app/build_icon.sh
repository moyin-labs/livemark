#!/usr/bin/env bash
# 将生成的PNG源图转换为macOS多尺寸应用图标。
set -euo pipefail
cd "$(dirname "$0")"

ICON_SOURCE="assets/app_icon.png"
ICON_SET=".build/AppIcon.iconset"
mkdir -p "$ICON_SET"

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_SOURCE" --out "$ICON_SET/icon_${size}x${size}.png" >/dev/null
  retina_size=$((size * 2))
  sips -z "$retina_size" "$retina_size" "$ICON_SOURCE" --out "$ICON_SET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICON_SET" -o .build/AppIcon.icns
