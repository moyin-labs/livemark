import AppKit

/// app 组 + 零散 JS→N 调用(契约 §3.1)。file 组的 N 发起调用(file.read/file.save)
/// 在 FileCoordinator, 此处只有 JS 发起的。
enum AppHandlers {

    static func register(on bridge: Bridge, viewController: EditorViewController) {

        bridge.registerHandler("file.requestFocus") { _ in
            await MainActor.run {
                viewController.focusWebView()
            }
            return .object([:])
        }

        bridge.registerHandler("file.readResource") { data in
            let value = try await MainActor.run { try viewController.readResource(data["src"]?.stringValue ?? "") }
            return .object(["dataURL": .string(value)])
        }
        bridge.registerHandler("file.list") { data in
            try await MainActor.run { try viewController.listFiles(path: data["path"]?.stringValue) }
        }
        bridge.registerHandler("file.open") { data in
            guard let path = data["path"]?.stringValue else { throw BridgeError.remote("文件路径为空") }
            await MainActor.run { viewController.openDocument(at: URL(fileURLWithPath: path)) }
            return .object([:])
        }
        bridge.onEvent("file.contextMenu") { [weak viewController] data in
            guard let path = data["path"]?.stringValue else { return }
            DispatchQueue.main.async { viewController?.showFileContextMenu(path: path) }
        }
        bridge.registerHandler("file.chooseFolder") { _ in
            let opened = await MainActor.run { viewController.chooseFolder() }
            return .object(["opened": .bool(opened)])
        }
        bridge.registerHandler("file.openLink") { data in
            await MainActor.run { viewController.openLink(data["href"]?.stringValue ?? "") }
            return .object([:])
        }

        // 握手自检: app.ready 后 echo 一发, 验证双向管道(契约 app.echo)
        bridge.onEvent("app.ready") { _ in
            MainActor.assumeIsolated {
                let start = CFAbsoluteTimeGetCurrent()
                bridge.callHandler("app.echo", data: .object(["ping": .string("ready")])) { result in
                    let elapsed = Int((CFAbsoluteTimeGetCurrent() - start) * 1000)
                    switch result {
                    case .success:
                        Log.bridge.info("roundtrip ok in \(elapsed)ms")
                    case .failure(let err):
                        Log.bridge.error("roundtrip failed: \(err.localizedDescription, privacy: .public)")
                    }
                }
            }
        }
    }
}
