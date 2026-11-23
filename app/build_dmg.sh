#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

./build_app.sh release
app_path="build/LiveMark.app"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")"
arch="$(xcrun lipo -archs "$app_path/Contents/MacOS/LiveMark")"
case "$arch" in
  arm64|x86_64) ;;
  *) echo "Unsupported application architecture: $arch" >&2; exit 1 ;;
esac
codesign --verify --deep --strict "$app_path"

staging="$(mktemp -d "$PWD/.build/dmg.XXXXXXXX")"
trap 'rm -r "$staging"' EXIT
mkdir -p "$staging/payload" dist
ditto "$app_path" "$staging/payload/LiveMark.app"
ln -s /Applications "$staging/payload/Applications"

dmg_name="LiveMark-$version-$arch.dmg"
hdiutil create -srcfolder "$staging/payload" -volname "LiveMark $version" -fs HFS+ -format UDZO "$staging/$dmg_name"
hdiutil verify "$staging/$dmg_name"
mv -f "$staging/$dmg_name" "dist/$dmg_name"
echo "dist/$dmg_name"
