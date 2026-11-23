import AppKit

/// window 组 handler(契约 §3.3)。
enum WindowHandlers {

    static func register(on bridge: Bridge, viewController: EditorViewController) {

        bridge.registerHandler("window.setTitle") { data in
            let title = data["title"]?.stringValue ?? ""
            await MainActor.run {
                if let window = viewController.view.window { window.title = title }
            }
            return .object([:])
        }

        bridge.registerHandler("window.setDirty") { data in
            let dirty = data["dirty"]?.boolValue ?? false
            await MainActor.run {
                if let window = viewController.view.window { window.isDocumentEdited = dirty }
            }
            return .object([:])
        }

        bridge.registerHandler("window.showDialog") { data in
            let kind = data["kind"]?.stringValue ?? "alert"
            let text = data["text"]?.stringValue ?? ""
            let buttons = data["buttons"]?.arrayValue?.compactMap(\.stringValue) ?? ["OK"]
            let index: Int = await MainActor.run {
                let alert = NSAlert()
                alert.messageText = text
                for label in buttons { alert.addButton(withTitle: label) }
                if kind == "confirm" { alert.alertStyle = .warning }
                return alert.runModal() == .alertFirstButtonReturn ? 0 : 1
            }
            return .object(["buttonIndex": .number(Double(index))])
        }
    }
}
