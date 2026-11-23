#!/usr/bin/env bash
# 打包内核: src/main.ts → esbuild IIFE bundle + static/ → ../Sources/LiveMark/Resources/WebKernel/
# 产物提交入库(app 构建不依赖 node)。重复 @codemirror/state 实例会炸 CM6 扩展,
# npm install 后不要手动往 bundle 里塞第二份 CM 包。
set -euo pipefail
cd "$(dirname "$0")"

OUT="../Sources/LiveMark/Resources/WebKernel"

echo "▶ tsc 类型检查"
npx tsc --noEmit

mkdir -p ../.build
echo "▶ esbuild bundle"
npx esbuild src/main.ts \
  --bundle \
  --format=iife \
  --target=safari16 \
  --minify \
  --metafile=../.build/kernel_meta.json \
  --loader:.css=text \
  --loader:.txt=text \
  --outfile="$OUT/main.js"

node scripts/generate_notices.mjs
echo "▶ 同步 static/"
rm -rf "$OUT/index.html" "$OUT/style"
cp -R static/index.html "$OUT/index.html"
cp -R static/style "$OUT/style"
cp node_modules/katex/dist/katex.min.css "$OUT/style/"
mkdir -p "$OUT/style/fonts"
cp -R node_modules/katex/dist/fonts/. "$OUT/style/fonts/"

echo "✅ $OUT"
ls -la "$OUT" "$OUT/style"
