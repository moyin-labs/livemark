import AppKit
import UniformTypeIdentifiers
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controllers: [MainWindowController] = []
    private var openingURLs: [URL] = []
    private var checkingTermination = false
    private var launched = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        launched = true
        let iconName = Bundle.main.object(forInfoDictionaryKey: "CFBundleIconFile") as? String ?? "AppIcon"
        let iconResource = (iconName as NSString).deletingPathExtension
        if let iconURL = Bundle.main.url(forResource: iconResource, withExtension: "icns"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApp.applicationIconImage = icon
        }
        MainMenu.install()
        ThemeManager.applyNativeAppearance()
        NSWindow.allowsAutomaticWindowTabbing = false
        if openingURLs.isEmpty { createDocument() }
        else { for url in openingURLs { createDocument(url: url) }; openingURLs.removeAll() }
    }
    @discardableResult func createDocument(url: URL? = nil) -> MainWindowController {
        let previous = NSApp.mainWindow ?? controllers.last?.window
        let controller = MainWindowController()
        controllers.append(controller)
        if let previous, let window = controller.window {
            window.cascadeTopLeft(from: NSPoint(x: previous.frame.minX, y: previous.frame.maxY))
        }
        controller.showAndActivate()
        if let url { controller.openDocument(at: url) }
        return controller
    }
    func forget(_ controller: MainWindowController) { controllers.removeAll { $0 === controller } }
    func isBusyWithFile(at url: URL) -> Bool {
        controllers.contains { $0.editorViewController.isBusyWithFile(at: url) }
    }
    func fileWasRenamed(from oldURL: URL, to newURL: URL) {
        MainMenu.renameRecent(from: oldURL, to: newURL)
        for controller in controllers { controller.editorViewController.fileWasRenamed(from: oldURL, to: newURL) }
    }
    func openDocument(_ url: URL) {
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        if let existing = controllers.first(where: { $0.window?.representedURL?.standardizedFileURL.resolvingSymlinksInPath() == canonical }) {
            existing.showAndActivate()
            MainMenu.noteRecent(canonical)
            return
        }
        createDocument(url: canonical)
    }
    @objc func newDocument(_ sender: Any?) { createDocument() }
    @objc func selectAllDocument(_ sender: Any?) {
        if let controller = NSApp.keyWindow?.windowController as? MainWindowController,
           controller.editorViewController.isWebViewFocused {
            controller.editorViewController.command("selectAll")
        } else {
            NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: sender)
        }
    }
    @objc func openDocumentPanel(_ sender: Any?) {
        NSApp.activate(ignoringOtherApps: true)
        let panel = NSOpenPanel()
        panel.allowedContentTypes = supportedTextTypes
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }
        for url in panel.urls { openDocument(url) }
    }
    @objc func openRecent(_ sender: NSMenuItem) {
        if let path = sender.representedObject as? String { openDocument(URL(fileURLWithPath: path)) }
    }
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        // 最近文档与窗口列表由AppKit生成，避免重复拼接系统菜单。
        let menu = NSMenu()
        for (title, action) in [("新建", #selector(newDocument(_:))), ("打开…", #selector(openDocumentPanel(_:)))] {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
            item.target = self
            menu.addItem(item)
        }
        return menu
    }
    func applyTheme(_ name: String) {
        guard ThemeManager.names.contains(name) else { return }
        ThemeManager.current = name
        ThemeManager.applyNativeAppearance()
        for controller in controllers { controller.editorViewController.bridge.callHandler("app.setTheme", data: .object(["theme": .string(name)])) }
    }
    func applyFont(_ name: String) {
        guard FontManager.names.contains(name) else { return }
        FontManager.current = name
        for controller in controllers { controller.editorViewController.bridge.callHandler("app.setFont", data: .object(["font": .string(name)])) }
    }
    // 未命名窗口由本应用创建，不交给仅用于最近文档记录的NSDocumentController。
    func applicationShouldOpenUntitledFile(_ sender: NSApplication) -> Bool { false }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows {
            if let existing = controllers.last { existing.showAndActivate() }
            else { createDocument() }
        }
        return true
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !controllers.isEmpty else { return .terminateNow }
        if checkingTermination { return .terminateCancel }
        checkingTermination = true
        let pending = controllers
        func confirm(_ index: Int) {
            guard index < pending.count else { checkingTermination = false; sender.reply(toApplicationShouldTerminate: true); return }
            pending[index].editorViewController.confirmClose { allow in
                if allow { confirm(index + 1) }
                else { self.checkingTermination = false; sender.reply(toApplicationShouldTerminate: false) }
            }
        }
        confirm(0)
        return .terminateLater
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        if !launched { openingURLs.append(contentsOf: urls); return }
        for url in urls { openDocument(url) }
    }
}
