# LiveMark

LiveMark 是 **Typora 的开源替代方案**，也是一款原生 macOS Markdown 编辑器。它支持在正文中直接编辑排版，也可以随时切换到 Markdown 源码。

- AppKit 提供独立文档窗口、大纲、文件侧栏和系统菜单。
- ProseMirror 负责即时编辑，CodeMirror 6 负责源码模式。
- 支持任务列表、表格、KaTeX 公式、Mermaid 图表、查找替换及 HTML 导出。
- 磁盘文件发生变化时自动刷新。有未保存修改时，用户可选择保留编辑或载入磁盘版本。

## 下载

从 [GitHub Releases](https://github.com/moyin-labs/livemark/releases) 按机型选取安装包。Apple 芯片选 `arm64`，Intel 芯片选 `x86_64`。打开 DMG 后，将 LiveMark 拖入“应用程序”。当前安装包使用 ad-hoc 签名，macOS 首次打开时可能拦截未经 Apple 公证的应用。

## 构建

需要 macOS 13 或更新版本，以及可用的 Swift 工具链。仓库包含预构建的 WebKernel，构建 macOS 应用无需 Node.js。

```bash
./app/build_app.sh
open app/build/LiveMark.app
```

修改 WebKernel 源码后，用 Node.js 和 npm 重新打包，再构建应用。

```bash
cd app/kernel-src
npm ci
./build.sh
cd ../..
./app/build_app.sh
```

运行 `./app/build_dmg.sh` 可在 `app/dist/` 生成当前机器架构的 DMG。公开版本号由仓库根目录的 `VERSION` 指定。推送与版本号匹配的标签（如 `v0.1.0`）后，GitHub Actions 会构建 Apple 芯片和 Intel 两个 DMG，并发布到同一个 Release。

## 测试

安装 WebKernel 依赖后，从仓库根目录运行 Markdown 解析与序列化检查。

```bash
mkdir -p app/.build/ui_validation
app/kernel-src/node_modules/.bin/esbuild app/tests/schema_check.ts --bundle --platform=node --format=cjs --outfile=app/.build/ui_validation/schema_check.cjs
node app/.build/ui_validation/schema_check.cjs
```

浏览器交互检查使用 `chrome-devtools` CLI。先在仓库根目录运行 `python3 -m http.server 8766 --bind 127.0.0.1`，再在另一个终端运行 `python3 app/tests/browser_check.py`。

## 项目结构

| 路径 | 内容 |
|---|---|
| `app/Sources/LiveMark/` | AppKit 窗口、文档管理、原生桥接和预构建 WebKernel |
| `app/kernel-src/` | 编辑器内核和界面资源 |
| `app/tests/` | 回归脚本和测试样例 |
| `docs/` | 开发文档 |

[桥接协议](docs/桥接协议.md)

## 许可证

LiveMark 自身代码采用 [Apache License 2.0](LICENSE)。附带的第三方组件遵循各自的许可证，详见 [第三方许可声明](app/ATTRIBUTIONS.md)。
