<img src="app/assets/app_icon.png" width="80" height="80" alt="LiveMark 应用图标">

# LiveMark

**简体中文** · [English](README.en.md)

**面向 macOS 的 Typora 开源替代方案。** 在排版后的正文中直接编辑 Markdown，按 `⌘/` 即可切换到源码模式。

[下载最新版本](https://github.com/moyin-labs/livemark/releases/latest)

## 安装

需要 macOS 13 或更新版本。按你的 Mac 芯片选择 DMG。

| Mac 芯片 | 安装包文件名后缀 |
|---|---|
| Apple 芯片（M 系列） | `-arm64.dmg` |
| Intel 芯片 | `-x86_64.dmg` |

打开 DMG，将 LiveMark 拖入“应用程序”。安装包使用 ad-hoc 签名，尚未经过 Apple 公证，首次打开时可能被 macOS 拦截。

## 主要功能

- 即时编辑与源码模式，分别由 ProseMirror 和 CodeMirror 6 提供。
- 独立文档窗口、大纲、文件侧栏与系统菜单。
- 可编辑表格和任务列表，渲染 KaTeX 公式和 Mermaid 图表。
- 查找替换、HTML 导出与外部文件更新检测。有未保存的编辑时，可选择保留修改或载入磁盘版本。

## 构建

在 macOS 上使用 Swift 5.9 或更新版本，从仓库根目录运行以下命令。仓库已包含预构建的 WebKernel，这一步无需 Node.js。

```bash
./app/build_app.sh
open app/build/LiveMark.app
```

修改 WebKernel 源码后，使用 Node.js 和 npm 重新打包，再构建应用。

```bash
(cd app/kernel-src && npm ci && ./build.sh)
./app/build_app.sh
```

本地运行 `./app/build_dmg.sh`，可在 `app/dist/` 生成当前机器架构的 DMG。推送与根目录 `VERSION` 匹配的标签（如 `v0.1.0`）后，GitHub Actions 会构建两种架构并将 DMG 上传至同一个 Release。

## 测试

安装 WebKernel 依赖后，从仓库根目录运行 Markdown 解析与序列化检查。

```bash
npm --prefix app/kernel-src ci
mkdir -p app/.build/ui_validation
app/kernel-src/node_modules/.bin/esbuild app/tests/schema_check.ts \
  --bundle --platform=node --format=cjs \
  --outfile=app/.build/ui_validation/schema_check.cjs
node app/.build/ui_validation/schema_check.cjs
```

浏览器交互检查使用 `chrome-devtools` CLI。先在仓库根目录运行 `python3 -m http.server 8766 --bind 127.0.0.1`，再在另一个终端运行 `python3 app/tests/browser_check.py`。

## 项目结构

| 路径 | 内容 |
|---|---|
| `app/Sources/LiveMark/` | AppKit 窗口、文档管理、原生桥接和预构建 WebKernel |
| `app/kernel-src/` | 编辑器内核和界面资源 |
| `app/tests/` | 回归脚本和测试样例 |
| `docs/` | 开发文档，包括[桥接协议](docs/桥接协议.md) |

## 许可证

LiveMark 自身代码采用 [Apache License 2.0](LICENSE)。附带的第三方组件遵循各自的许可证，详见 [第三方许可声明](app/ATTRIBUTIONS.md)。
