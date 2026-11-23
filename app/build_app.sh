#!/usr/bin/env bash
# 组装 LiveMark.app: SwiftPM 产物 → 手工 .app bundle → ad-hoc 签名
# 用法: ./build_app.sh [debug|release]  (默认 release)
set -euo pipefail
cd "$(dirname "$0")"

CONFIG="${1:-release}"
APP_NAME="LiveMark"

echo "▶ 生成macOS应用图标"
bash ./build_icon.sh

echo "▶ swift build -c $CONFIG"
swift build -c "$CONFIG"

APP="build/${APP_NAME}.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp ".build/$CONFIG/$APP_NAME" "$APP/Contents/MacOS/$APP_NAME"
cp Info.plist "$APP/Contents/Info.plist"
if [[ -f ../VERSION ]]; then
  RELEASE_VERSION="$(< ../VERSION)"
  if [[ ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "VERSION must contain a version such as 0.1.0" >&2
    exit 1
  fi
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $RELEASE_VERSION" "$APP/Contents/Info.plist"
fi

# 图标内容变化时使用新资源名，避免macOS继续命中旧图标缓存。
ICON_DIGEST="$(shasum -a 256 .build/AppIcon.icns)"
ICON_NAME="AppIcon-${ICON_DIGEST:0:12}"
cp .build/AppIcon.icns "$APP/Contents/Resources/$ICON_NAME.icns"
/usr/libexec/PlistBuddy -c "Set :CFBundleIconFile $ICON_NAME" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# KernelResources显式从Contents/Resources读取资源包，避免Bundle.module回落到构建路径。
cp -R ".build/$CONFIG/${APP_NAME}_${APP_NAME}.bundle" "$APP/Contents/Resources/"

if [[ -f ../LICENSE ]]; then
  cp ../LICENSE "$APP/Contents/Resources/LICENSE"
fi

codesign --force --sign - "$APP" >/dev/null 2>&1
echo "✅ $APP"
