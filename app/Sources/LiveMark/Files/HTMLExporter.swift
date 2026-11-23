import AppKit

/// HTML 导出: 拉内核渲染结果(契约 export.requestHtml) → SavePanel → 写盘。
/// 处理编辑器生成的独立 HTML。
enum HTMLExporter {

    static func render(viewController: EditorViewController, completion: @escaping (String) -> Void) {
        viewController.bridge.callHandler("export.requestHtml", data: .object(["standalone": .bool(true)])) { result in
            switch result {
            case .success(let response): completion(embedFonts(response["html"]?.stringValue ?? ""))
            case .failure(let error): NSAlert(error: error).runModal()
            }
        }
    }
    static func export(viewController: EditorViewController) {
        viewController.bridge.callHandler("export.requestHtml", data: .object(["standalone": .bool(true)])) { result in
            MainActor.assumeIsolated {
                switch result {
                case .success(let resp):
                    let html = embedFonts(resp["html"]?.stringValue ?? "")
                    guard !html.isEmpty else {
                        Log.file.error("export: empty html from kernel")
                        return
                    }
                    runSavePanel(html: html, viewController: viewController)
                case .failure(let err):
                    Log.file.error("export failed: \(err.localizedDescription, privacy: .public)")
                }
            }
        }
    }

    private static func runSavePanel(html: String, viewController: EditorViewController) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.html]
        panel.nameFieldStringValue = suggestedName(viewController)
        guard panel.runModal() == .OK, let url = panel.url else { return }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try html.write(to: url, atomically: true, encoding: .utf8)
                DispatchQueue.main.async {
                    Log.file.info("exported \(url.lastPathComponent, privacy: .public) (\(html.utf16.count) chars)")
                }
            } catch {
                DispatchQueue.main.async {
                    let alert = NSAlert(error: error)
                    alert.runModal()
                }
            }
        }
    }

    private static func embedFonts(_ html: String) -> String {
        guard let root = KernelResources.root?.appendingPathComponent("style"),
              let regex = try? NSRegularExpression(pattern: #"url\((fonts/[A-Za-z0-9_-]+\.(woff2|woff|ttf))\)"#) else { return html }
        var result = html
        let matches = regex.matches(in: html, range: NSRange(html.startIndex..., in: html))
        for match in matches.reversed() {
            guard let pathRange = Range(match.range(at: 1), in: html), let range = Range(match.range, in: result),
                  let data = try? Data(contentsOf: root.appendingPathComponent(String(html[pathRange]))) else { continue }
            let ext = (String(html[pathRange]) as NSString).pathExtension
            let mime = ext == "ttf" ? "font/ttf" : "font/\(ext)"
            result.replaceSubrange(range, with: "url(data:\(mime);base64,\(data.base64EncodedString()))")
        }
        return result
    }
    private static func suggestedName(_ viewController: EditorViewController) -> String {
        let title = viewController.view.window?.title ?? "Untitled"
        let stem = (title as NSString).deletingPathExtension
        return stem.isEmpty ? "Untitled.html" : "\(stem).html"
    }
}
