import AppKit
import UniformTypeIdentifiers

final class MainWindowController: NSWindowController, NSWindowDelegate, NSMenuItemValidation {
    let editorViewController: EditorViewController
    private var closing = false
    private var sourceButton: NSButton?
    private var changingFullScreen = false
    private var renamePopover: NSPopover?
    init() {
        let editor = EditorViewController()
        editorViewController = editor
        let window = DocumentWindow(contentViewController: editor)
        window.styleMask.insert([.resizable, .miniaturizable, .closable])
        window.minSize = WindowLayout.minimumSize
        let size = WindowLayout.rememberedSize()
        let visibleFrame = (NSApp.mainWindow?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(origin: .zero, size: size)
        window.setFrame(WindowLayout.fittedFrame(size: size, topLeft: NSPoint(x: visibleFrame.minX, y: visibleFrame.maxY), visibleFrame: visibleFrame), display: false)
        window.title = "未命名"
        window.isRestorable = false
        window.tabbingMode = .disallowed
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.backgroundColor = ThemeManager.backgroundColor
        super.init(window: window)
        window.delegate = self
        window.onRenameDocument = { [weak self] in self?.showDocumentRename(nil) }
        window.center()
        // 源码和侧栏入口统一放在右上角，左下角保留完整写作背景。
        let accessory = NSTitlebarAccessoryViewController()
        let button = NSButton(image: NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: "切换侧栏")!, target: self, action: #selector(toggleSidebar(_:)))
        button.bezelStyle = .inline
        button.isBordered = false
        button.frame = NSRect(x: 0, y: 0, width: 36, height: 24)
        button.toolTip = "切换侧栏"
        let source = NSButton(image: NSImage(systemSymbolName: "chevron.left.forwardslash.chevron.right", accessibilityDescription: "切换Markdown源码")!, target: self, action: #selector(toggleSource(_:)))
        source.bezelStyle = .inline
        source.isBordered = false
        source.toolTip = "切换Markdown源码 ⌘/"
        sourceButton = source
        let controls = NSStackView(views: [source, button])
        controls.orientation = .horizontal
        controls.spacing = 2
        controls.frame = NSRect(x: 0, y: 0, width: 74, height: 24)
        for control in [source, button] {
            control.widthAnchor.constraint(equalToConstant: 36).isActive = true
            control.heightAnchor.constraint(equalToConstant: 24).isActive = true
        }
        accessory.view = controls
        accessory.layoutAttribute = .right
        window.addTitlebarAccessoryViewController(accessory)
        editor.onModeChange = { [weak self] mode in
            let active = mode == .source
            self?.sourceButton?.state = active ? .on : .off
            self?.sourceButton?.contentTintColor = active ? .controlAccentColor : .secondaryLabelColor
            self?.sourceButton?.toolTip = active ? "返回即时编辑 ⌘/" : "切换Markdown源码 ⌘/"
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func showAndActivate() {
        if window?.isMiniaturized == true { window?.deminiaturize(nil) }
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        editorViewController.checkForExternalChanges()
    }
    func windowDidBecomeKey(_ notification: Notification) { editorViewController.checkForExternalChanges() }
    func windowDidResize(_ notification: Notification) {
        guard let window, !window.inLiveResize else { return }
        rememberWindowSize()
    }
    func windowDidEndLiveResize(_ notification: Notification) { rememberWindowSize() }
    private func rememberWindowSize() {
        guard let window, window.isVisible, !changingFullScreen,
              !window.styleMask.contains(.fullScreen) else { return }
        WindowLayout.remember(window.frame.size)
    }
    func windowWillEnterFullScreen(_ notification: Notification) { changingFullScreen = true }
    func windowDidEnterFullScreen(_ notification: Notification) { changingFullScreen = false }
    func windowWillExitFullScreen(_ notification: Notification) { changingFullScreen = true }
    func windowDidExitFullScreen(_ notification: Notification) { changingFullScreen = false }
    func windowWillClose(_ notification: Notification) { renamePopover?.performClose(nil); editorViewController.shutdown(); (NSApp.delegate as? AppDelegate)?.forget(self) }
    func openDocument(at url: URL) { editorViewController.openDocument(at: url) }
    @objc func openFolder(_ sender: Any?) { if editorViewController.chooseFolder() { editorViewController.command("files") } }
    @objc func saveDocument(_ sender: Any?) { editorViewController.saveDocument() }
    @objc func saveDocumentAs(_ sender: Any?) { editorViewController.saveDocumentAs() }
    @objc func showDocumentRename(_ sender: Any?) {
        guard let window = window as? DocumentWindow,
              let anchorView = window.contentView else { return }
        guard let url = window.representedURL else { editorViewController.saveDocumentAs(); return }
        if renamePopover?.isShown == true { return }
        let controller = DocumentRenameViewController(filename: url.lastPathComponent) { [weak self] name in
            try self?.editorViewController.renameDocument(to: name)
        }
        let popover = NSPopover()
        popover.behavior = .applicationDefined
        popover.animates = false
        popover.contentViewController = controller
        popover.contentSize = controller.view.fittingSize
        controller.popover = popover
        renamePopover = popover
        let titleRect = anchorView.convert(window.documentTitleRect, from: nil)
        let anchor = NSRect(x: titleRect.midX - 1, y: anchorView.isFlipped ? anchorView.bounds.minY : anchorView.bounds.maxY - 1, width: 2, height: 1)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        popover.show(relativeTo: anchor, of: anchorView, preferredEdge: .minY)
        controller.view.window?.makeKeyAndOrderFront(nil)
    }
    @objc func exportHTML(_ sender: Any?) { editorViewController.exportHTML() }
    @objc func toggleSidebar(_ sender: Any?) { editorViewController.command("sidebar") }
    @objc func toggleSource(_ sender: Any?) { editorViewController.command("source") }
    @objc func editorCommand(_ sender: NSMenuItem) { guard let command = sender.representedObject as? String else { return }; editorViewController.command(command) }
    @objc func selectTheme(_ sender: NSMenuItem) { guard let name = sender.representedObject as? String else { return }; (NSApp.delegate as? AppDelegate)?.applyTheme(name) }
    @objc func selectFont(_ sender: NSMenuItem) { guard let name = sender.representedObject as? String else { return }; (NSApp.delegate as? AppDelegate)?.applyFont(name) }
    @objc func printDocument(_ sender: Any?) { editorViewController.printDocument() }
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(selectTheme(_:)) { menuItem.state = menuItem.representedObject as? String == ThemeManager.current ? .on : .off }
        if menuItem.action == #selector(selectFont(_:)) { menuItem.state = menuItem.representedObject as? String == FontManager.current ? .on : .off }
        return true
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closing { return true }
        editorViewController.confirmClose { [weak self, weak sender] allow in
            guard let self, allow else { return }
            self.closing = true
            sender?.close()
        }
        return false
    }
}
let markdownUTType = UTType(filenameExtension: "md") ?? .plainText
let supportedTextTypes = [markdownUTType, .plainText, .json, UTType(filenameExtension: "yaml") ?? .plainText]
let supportedTextExtensions = ["md", "markdown", "mdown", "mkd", "txt", "json", "yaml", "yml"]
