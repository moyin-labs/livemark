import AppKit
import WebKit
final class DocWebView: WKWebView, WKNavigationDelegate {
    let resourceHandler: ResourceHandler
    private var entryPath: String?
    var openLocalDocument: ((URL) -> Void)?
    init(initialTheme: String) {
        let config = WKWebViewConfiguration()
        resourceHandler = ResourceHandler()
        config.setURLSchemeHandler(resourceHandler, forURLScheme: "livemark-resource")
        let script = "document.documentElement.dataset.theme = '\(initialTheme)'; document.documentElement.dataset.font = '\(FontManager.current)';"
        config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.setValue(false, forKey: "drawsBackground")
        super.init(frame: .zero, configuration: config)
        translatesAutoresizingMaskIntoConstraints = false
        navigationDelegate = self
        setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) { isInspectable = true }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func loadKernel(at entryURL: URL) { entryPath = entryURL.path; loadFileURL(entryURL, allowingReadAccessTo: entryURL.deletingLastPathComponent()) }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        // 标准Edit菜单是WebKit剪贴板与responder chain的必要宿主接线。
        if event.modifierFlags.contains(.command), NSApp.mainMenu?.performKeyEquivalent(with: event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.navigationType == .linkActivated, ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url); decisionHandler(.cancel) }
        else if url.isFileURL && url.path == entryPath { decisionHandler(.allow) }
        else if url.isFileURL && supportedTextExtensions.contains(url.pathExtension.lowercased()) { openLocalDocument?(url); decisionHandler(.cancel) }
        else { decisionHandler(.cancel) }
    }
    #if DEBUG
    func enableDeveloperExtras() { configuration.preferences.setValue(true, forKey: "developerExtrasEnabled") }
    #endif
}
