import AppKit
import WebKit

enum EditorMode: String {
    case live, source, preview
}

/// 单个WKWebView承载即时编辑、源码与预览。原生层负责文档生命周期与受控资源读取。
final class EditorViewController: NSViewController {

    private var webView: DocWebView!
    private(set) var bridge: Bridge!
    private var fileCoordinator: FileCoordinator!
    private var printSession: PrintSession?
    var onModeChange: ((EditorMode) -> Void)?

    // MARK: - 生命周期

    override func loadView() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 1120, height: 760))
        webView = DocWebView(initialTheme: ThemeManager.current)
        webView.openLocalDocument = { [weak self] url in self?.openDocument(at: url) }
        #if DEBUG
        webView.enableDeveloperExtras()
        #endif
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        view = container
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        setupBridge()
        loadKernel()
    }

    private func loadKernel() {
        guard let kernelURL = KernelResources.root?.appendingPathComponent("index.html") else {
            Log.app.fault("WebKernel resource not found")
            return
        }
        webView.loadKernel(at: kernelURL)
    }

    func focusWebView() {
        view.window?.makeFirstResponder(webView)
    }
    var isWebViewFocused: Bool {
        guard let responder = view.window?.firstResponder as? NSView else { return false }
        return responder === webView || responder.isDescendant(of: webView)
    }

    // MARK: - Bridge 接线(契约 v1 §3)

    private func setupBridge() {
        let bridge = Bridge()
        self.bridge = bridge
        bridge.attach(to: webView)
        bridge.onEvent("mode.changed") { [weak self] data in
            guard let name = data["mode"]?.stringValue, let mode = EditorMode(rawValue: name) else { return }
            self?.onModeChange?(mode)
        }

        fileCoordinator = FileCoordinator(viewController: self)
        fileCoordinator.attach(bridge: bridge)
        WindowHandlers.register(on: bridge, viewController: self)
        AppHandlers.register(on: bridge, viewController: self)
    }

    // MARK: - MainWindowController 转发的动作

    func newDocument() {
        fileCoordinator.newDocument()
    }

    func openDocument(at url: URL) {
        fileCoordinator.openDocument(at: url)
    }

    func saveDocument() {
        fileCoordinator.save()
    }

    func saveDocumentAs() {
        fileCoordinator.saveAs()
    }
    func renameDocument(to name: String) throws { try fileCoordinator.renameDocument(to: name) }

    func exportHTML() {
        HTMLExporter.export(viewController: self)
    }

    func setMode(_ mode: EditorMode) {
        bridge.callHandler("mode.set", data: .object(["mode": .string(mode.rawValue)]))
    }

    func toggleTheme() {
        ThemeManager.toggle(bridge: bridge)
    }

    func confirmClose(_ completion: @escaping (Bool) -> Void) {
        fileCoordinator.confirmClose(completion)
    }

    func shutdown() { fileCoordinator.shutdown(); webView.stopLoading(); bridge.detach() }
    func checkForExternalChanges() { fileCoordinator?.checkForExternalChanges() }
    func printDocument() {
        guard printSession == nil else { return }
        HTMLExporter.render(viewController: self) { [weak self] html in
            self?.printSession = PrintSession(html: html) { [weak self] in self?.printSession = nil }
        }
    }
    func command(_ name: String, data: [String: JSONValue] = [:]) {
        var payload = data
        payload["command"] = .string(name)
        bridge.callHandler("editor.command", data: .object(payload))
    }
    func readResource(_ source: String) throws -> String { try webView.resourceHandler.dataURL(source) }
    func setResourceRoot(_ url: URL?) { webView.resourceHandler.root = url }
    func chooseFolder() -> Bool { fileCoordinator.chooseFolder() }
    func listFiles(path: String?) throws -> JSONValue { try fileCoordinator.listFiles(path: path) }
    func showFileContextMenu(path: String) { fileCoordinator.showContextMenu(path: path) }
    func isBusyWithFile(at url: URL) -> Bool { fileCoordinator.isBusyWithFile(at: url) }
    func fileWasRenamed(from oldURL: URL, to newURL: URL) { fileCoordinator.fileWasRenamed(from: oldURL, to: newURL) }
    func openLink(_ href: String) { fileCoordinator.openLink(href) }
    func applyTheme(_ name: String) { ThemeManager.set(name, bridge: bridge) }
}
