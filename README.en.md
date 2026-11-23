<img src="app/assets/app_icon.png" width="80" height="80" alt="LiveMark app icon">

# LiveMark

[简体中文](README.md) · **English**

**An open-source alternative to Typora for macOS.** Edit formatted Markdown directly and press `⌘/` to switch to source mode.

[Download the latest release](https://github.com/moyin-labs/livemark/releases/latest)

## Install

LiveMark requires macOS 13 or later. Choose the DMG for your Mac’s processor.

| Mac processor | Installer filename suffix |
|---|---|
| Apple silicon (M series) | `-arm64.dmg` |
| Intel | `-x86_64.dmg` |

Open the DMG and drag LiveMark into Applications. The installers use ad-hoc signing and have yet to be notarized by Apple, so macOS may block the first launch.

## Features

- Live editing powered by ProseMirror and source mode powered by CodeMirror 6.
- Independent document windows, an outline, a file sidebar, and native menus.
- Editable tables and task lists, with KaTeX math and Mermaid diagrams.
- Find and replace, HTML export, and detection of external file changes. If you have unsaved edits, you can keep them or reload the file from disk.

## Build

On macOS with Swift 5.9 or later, run the following from the repository root. The repository includes a prebuilt WebKernel, so this step does not require Node.js.

```bash
./app/build_app.sh
open app/build/LiveMark.app
```

After changing the WebKernel source, use Node.js and npm to rebuild it, then rebuild the app.

```bash
(cd app/kernel-src && npm ci && ./build.sh)
./app/build_app.sh
```

Run `./app/build_dmg.sh` to produce a DMG for the current Mac’s architecture in `app/dist/`. When a version tag that matches the root `VERSION` file is pushed (for example, `v0.1.0`), GitHub Actions builds both architectures and uploads the DMGs to the same release.

## Test

From the repository root, install the WebKernel dependencies and run the Markdown parsing and serialization checks.

```bash
npm --prefix app/kernel-src ci
mkdir -p app/.build/ui_validation
app/kernel-src/node_modules/.bin/esbuild app/tests/schema_check.ts \
  --bundle --platform=node --format=cjs \
  --outfile=app/.build/ui_validation/schema_check.cjs
node app/.build/ui_validation/schema_check.cjs
```

Browser interaction checks use the `chrome-devtools` CLI. Run `python3 -m http.server 8766 --bind 127.0.0.1` from the repository root, then run `python3 app/tests/browser_check.py` in a second terminal.

## Repository layout

| Path | Contents |
|---|---|
| `app/Sources/LiveMark/` | AppKit windows, document management, the native bridge, and the prebuilt WebKernel |
| `app/kernel-src/` | Editor kernel and UI assets |
| `app/tests/` | Regression scripts and test fixtures |
| `docs/` | Developer documentation, including the [bridge protocol](docs/桥接协议.md) in Chinese |

## License

LiveMark is licensed under the [Apache License 2.0](LICENSE). Bundled third-party components retain their own licenses. [Third-party notices](app/ATTRIBUTIONS.md)
