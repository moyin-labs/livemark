import AppKit
import UniformTypeIdentifiers

final class RenameTextField: NSTextField {
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted, let editor = currentEditor() {
            let name = stringValue as NSString
            let suffix = name.pathExtension as NSString
            let length = suffix.length == 0 ? name.length : name.length - suffix.length - 1
            editor.selectedRange = NSRange(location: 0, length: max(0, length))
        }
        return accepted
    }
}

/// 文档切换统一经过内核快照确认；保存按文档ID与内容版本结算。
final class FileCoordinator: NSObject {
    private(set) var fileURL: URL?
    private(set) var folderURL: URL?
    private(set) var documentID = UUID().uuidString
    private weak var bridge: Bridge?
    private unowned let viewController: EditorViewController
    private var generation = 0
    private var retryWork: DispatchWorkItem?
    private var pendingContent = ""
    private var currentRevision = 0
    private var transitioning = false
    private var readRequest = 0
    private var pendingReadURL: URL?
    private var writingPaths: [URL: Int] = [:]
    private let changeMonitor = FileChangeMonitor()
    private var diskContent = ""
    private var externalConflict: String?
    private var documentLoaded = false
    private var checkingExternal = false
    private var checkAgain = false
    private var externalRequest = 0
    private var stopped = false
    private var window: NSWindow? { viewController.view.window }
    init(viewController: EditorViewController) {
        self.viewController = viewController
        super.init()
        changeMonitor.onChange = { [weak self] in self?.checkForExternalChanges() }
    }
    func attach(bridge: Bridge) {
        self.bridge = bridge
        bridge.onEvent("file.contentChanged") { [weak self] data in
            guard let self, data["documentID"]?.stringValue == self.documentID else { return }
            self.currentRevision = Int(data["revision"]?.numberValue ?? 0)
            self.window?.isDocumentEdited = data["dirty"]?.boolValue ?? true
            if data["dirty"]?.boolValue == false { self.checkForExternalChanges() }
        }
        bridge.onEvent("file.readAck") { [weak self] data in
            guard let self, data["documentID"]?.stringValue == self.documentID,
                  Int(data["generation"]?.numberValue ?? -1) == self.generation else { return }
            self.retryWork?.cancel()
            self.documentLoaded = true
            self.checkForExternalChanges()
        }
        bridge.onEvent("app.ready") { [weak self] _ in
            guard let self else { return }
            if self.generation == 0 { self.replaceDocument("", at: nil) }
        }
        bridge.registerHandler("file.reloadFromDisk") { [weak self] data in
            guard let self else { return .object([:]) }
            await MainActor.run {
                guard data["documentID"]?.stringValue == self.documentID,
                      let url = self.fileURL, self.writingPaths.isEmpty, self.pendingReadURL == nil else { return }
                switch data["action"]?.stringValue {
                case "reload": self.readDocument(at: url)
                case "overwrite": self.write(to: url, completion: nil, overwriteExternal: true)
                case "saveAs": self.saveAs()
                default: break
                }
            }
            return .object([:])
        }
    }
    func newDocument() {
        withDocumentProtection { [weak self] in self?.replaceDocument("", at: nil) }
    }
    func openDocument(at url: URL) {
        withDocumentProtection { [weak self] in self?.readDocument(at: url) }
    }
    private func readDocument(at url: URL) {
        bridge?.callHandler("editor.setBusy", data: .object(["busy": .bool(true)]))
        readRequest += 1
        let request = readRequest
        pendingReadURL = url
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = Result { try Self.readText(url) }
            DispatchQueue.main.async {
                guard let self, self.readRequest == request else { return }
                self.pendingReadURL = nil
                defer { self.bridge?.callHandler("editor.setBusy", data: .object(["busy": .bool(false)])) }
                switch result {
                case .success(let content): self.replaceDocument(content, at: url)
                case .failure(let error): self.showError(error)
                }
            }
        }
    }
    private func replaceDocument(_ content: String, at url: URL?) {
        retryWork?.cancel()
        externalRequest += 1
        checkingExternal = false
        checkAgain = false
        documentLoaded = false
        diskContent = content
        externalConflict = nil
        documentID = UUID().uuidString
        fileURL = url
        if let url { MainMenu.noteRecent(url) }
        currentRevision = 0
        generation += 1
        pendingContent = content
        window?.title = url?.lastPathComponent ?? "未命名"
        window?.representedURL = url
        window?.isDocumentEdited = false
        viewController.setResourceRoot(url?.deletingLastPathComponent())
        sendTrackedRead(retries: 2)
        changeMonitor.start(at: url)
        bridge?.emit("file.listChanged")
    }
    func shutdown() {
        stopped = true
        readRequest += 1
        externalRequest += 1
        retryWork?.cancel()
        changeMonitor.stop()
    }

    /// 脏态最终由内核在应用新内容的同一事务入口检查，避免读取期间继续输入被覆盖。
    func checkForExternalChanges() {
        guard !stopped, let url = fileURL, documentLoaded else { return }
        guard !transitioning, pendingReadURL == nil, writingPaths.isEmpty, !checkingExternal else {
            checkAgain = true
            return
        }
        checkingExternal = true
        checkAgain = false
        externalRequest += 1
        let request = externalRequest
        let expectedID = documentID
        let baseline = diskContent
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let result = Result { try Self.readText(url) }
            DispatchQueue.main.async {
                guard let self, !self.stopped, self.externalRequest == request,
                      self.documentID == expectedID, self.fileURL == url else { return }
                guard case .success(let content) = result else {
                    // 删除或临时不可读时保留当前文档，父目录监听会捕获文件重新出现。
                    self.finishExternalCheck(request)
                    return
                }
                guard content != baseline else {
                    if self.externalConflict != nil { self.setExternalConflict(nil) }
                    self.finishExternalCheck(request)
                    return
                }
                self.bridge?.callHandler("file.reloadIfClean", data: .object([
                    "documentID": .string(expectedID), "content": .string(content),
                    "expectedContent": .string(baseline),
                ])) { [weak self] response in
                    guard let self, !self.stopped, self.externalRequest == request,
                          self.documentID == expectedID, self.fileURL == url else { return }
                    switch response {
                    case .success(let value):
                        if value["reloaded"]?.boolValue == true {
                            self.diskContent = content
                            self.pendingContent = content
                            self.setExternalConflict(nil)
                            self.bridge?.emit("file.listChanged")
                        } else if value["reason"]?.stringValue != "documentChanged" {
                            self.setExternalConflict(content)
                        }
                    case .failure: break // 下次文件事件或窗口激活时重试，不打断输入。
                    }
                    self.finishExternalCheck(request)
                }
            }
        }
    }

    private func finishExternalCheck(_ request: Int) {
        guard externalRequest == request else { return }
        checkingExternal = false
        if checkAgain {
            checkAgain = false
            DispatchQueue.main.async { [weak self] in self?.checkForExternalChanges() }
        }
    }

    private func setExternalConflict(_ content: String?) {
        guard externalConflict != content else { return }
        externalConflict = content
        bridge?.emit("file.externalChange", data: .object([
            "documentID": .string(documentID), "changed": .bool(content != nil),
        ]))
    }
    private func sendTrackedRead(retries: Int) {
        let currentGeneration = generation
        bridge?.callHandler("file.read", data: .object([
            "path": .string(fileURL?.path ?? ""), "content": .string(pendingContent),
            "generation": .number(Double(generation)), "documentID": .string(documentID),
        ]))
        retryWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.generation == currentGeneration else { return }
            if retries > 0 { self.sendTrackedRead(retries: retries - 1) }
            else { self.showMessage("编辑器未能载入文档", detail: "请重新打开文档。原文件未被修改。") }
        }
        retryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
    }
    private func withDocumentProtection(_ operation: @escaping () -> Void) {
        guard !transitioning else { return }
        transitioning = true
        confirmClose { [weak self] allowed in
            self?.transitioning = false
            if allowed { operation() }
        }
    }
    /// 直接询问内核，避免最后一个输入的桥消息还未到达时丢失脏态。
    func confirmClose(_ completion: @escaping (Bool) -> Void) {
        guard let bridge else { completion(false); return }
        bridge.callHandler("file.status") { [weak self] result in
            guard let self else { completion(false); return }
            switch result {
            case .success(let status):
                guard status["dirty"]?.boolValue == true else { completion(true); return }
                let alert = NSAlert()
                alert.messageText = "要保存对“\(self.window?.title ?? "未命名")”的更改吗？"
                alert.informativeText = "如果不保存，这些更改将会丢失。"
                alert.addButton(withTitle: "保存")
                alert.addButton(withTitle: "不保存").keyEquivalent = "d"
                alert.addButton(withTitle: "取消").keyEquivalent = "\u{1b}"
                switch alert.runModal() {
                case .alertFirstButtonReturn: self.save(completion)
                case .alertSecondButtonReturn: completion(true)
                default: completion(false)
                }
            case .failure(let error): self.showError(error); completion(false)
            }
        }
    }
    func save(_ completion: ((Bool) -> Void)? = nil) {
        if let url = fileURL { write(to: url, completion: completion) }
        else { saveAs(completion) }
    }
    func saveAs(_ completion: ((Bool) -> Void)? = nil) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [fileURL.flatMap { UTType(filenameExtension: $0.pathExtension) } ?? markdownUTType]
        panel.nameFieldStringValue = fileURL?.lastPathComponent ?? "未命名.md"
        panel.directoryURL = fileURL?.deletingLastPathComponent() ?? folderURL
        guard panel.runModal() == .OK, let url = panel.url else { completion?(false); return }
        write(to: url, completion: completion)
    }
    private func write(to url: URL, completion: ((Bool) -> Void)?, overwriteExternal: Bool = false) {
        guard let bridge else { completion?(false); return }
        let writingPath = url.standardizedFileURL.resolvingSymlinksInPath()
        writingPaths[writingPath, default: 0] += 1
        let finish: (Bool) -> Void = { [weak self] success in
            if let self {
                let count = (self.writingPaths[writingPath] ?? 1) - 1
                if count == 0 { self.writingPaths.removeValue(forKey: writingPath) }
                else { self.writingPaths[writingPath] = count }
                if self.checkAgain { self.checkForExternalChanges() }
            }
            completion?(success)
        }
        let expectedID = documentID
        bridge.callHandler("file.save") { [weak self] result in
            guard let self else { finish(false); return }
            switch result {
            case .success(let response):
                guard response["documentID"]?.stringValue == expectedID, self.documentID == expectedID,
                      let content = response["content"]?.stringValue else { finish(false); return }
                let revision = Int(response["revision"]?.numberValue ?? 0)
                let baseline = self.diskContent
                let isCurrentFile = self.fileURL?.standardizedFileURL.resolvingSymlinksInPath() == writingPath
                DispatchQueue.global(qos: .userInitiated).async {
                    do {
                        if !overwriteExternal, isCurrentFile,
                           let latest = try? Self.readText(url), latest != baseline, latest != content {
                            DispatchQueue.main.async {
                                guard self.documentID == expectedID else { finish(false); return }
                                self.setExternalConflict(latest)
                                finish(false)
                            }
                            return
                        }
                        try content.write(to: url, atomically: true, encoding: .utf8)
                        DispatchQueue.main.async {
                            guard self.documentID == expectedID else { finish(false); return }
                            self.fileURL = url
                            self.diskContent = content
                            self.setExternalConflict(nil)
                            self.changeMonitor.start(at: url)
                            MainMenu.noteRecent(url)
                            self.window?.title = url.lastPathComponent
                            self.window?.representedURL = url
                            self.viewController.setResourceRoot(url.deletingLastPathComponent())
                            self.bridge?.emit("file.pathChanged", data: .object(["path": .string(url.path)]))
                            self.bridge?.emit("file.writeDone", data: .object(["path": .string(url.path), "content": .string(content), "documentID": .string(expectedID)]))
                            self.window?.isDocumentEdited = self.currentRevision != revision
                            self.bridge?.emit("file.listChanged")
                            // 保存过程中继续输入时不允许直接关闭，保留新内容。
                            finish(self.currentRevision == revision)
                        }
                    } catch { DispatchQueue.main.async { self.showError(error); finish(false) } }
                }
            case .failure(let error): self.showError(error); finish(false)
            }
        }
    }
    func isBusyWithFile(at url: URL) -> Bool {
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        return writingPaths[canonical] != nil || pendingReadURL?.standardizedFileURL.resolvingSymlinksInPath() == canonical
    }
    func fileWasRenamed(from oldURL: URL, to newURL: URL) {
        if fileURL?.standardizedFileURL == oldURL.standardizedFileURL {
            fileURL = newURL
            externalRequest += 1
            checkingExternal = false
            changeMonitor.start(at: newURL)
            checkForExternalChanges()
            window?.title = newURL.lastPathComponent
            window?.representedURL = newURL
            viewController.setResourceRoot(newURL.deletingLastPathComponent())
            bridge?.emit("file.pathChanged", data: .object(["path": .string(newURL.path)]))
        }
        bridge?.emit("file.listChanged")
    }
    /// 文件树右键使用原生菜单，避免WebKit弹出文本查询、翻译等菜单。
    func showContextMenu(path: String) {
        do {
            let url = try sidebarURL(path: path)
            guard let window else { return }
            let menu = NSMenu()
            menu.autoenablesItems = false
            let actions: [(String, Selector)] = [
                ("在Finder中显示", #selector(revealFile(_:))),
                ("复制文件路径", #selector(copyFilePath(_:))),
                ("复制文件名", #selector(copyFileName(_:))),
            ]
            for (title, action) in actions {
                let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
                item.target = self; item.representedObject = url
                menu.addItem(item)
            }
            if try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory != true {
                menu.addItem(.separator())
                let rename = NSMenuItem(title: "重命名…", action: #selector(renameFile(_:)), keyEquivalent: "")
                rename.target = self; rename.representedObject = url
                menu.addItem(rename)
            }
            let view = viewController.view
            menu.popUp(positioning: nil, at: view.convert(window.mouseLocationOutsideOfEventStream, from: nil), in: view)
        } catch { showError(error) }
    }
    private func sidebarURL(path: String) throws -> URL {
        guard path.hasPrefix("/"), let root = folderURL ?? fileURL?.deletingLastPathComponent() else { throw CocoaError(.fileReadNoPermission) }
        let url = URL(fileURLWithPath: path).standardizedFileURL
        let resolvedRoot = root.resolvingSymlinksInPath().path
        let parent = url.deletingLastPathComponent().resolvingSymlinksInPath().path
        guard parent == resolvedRoot || parent.hasPrefix(resolvedRoot + "/") else { throw CocoaError(.fileReadNoPermission) }
        guard FileManager.default.fileExists(atPath: url.path) else { throw CocoaError(.fileNoSuchFile) }
        return url
    }
    @objc private func revealFile(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
    private func copyText(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
    @objc private func copyFilePath(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        copyText(url.path)
    }
    @objc private func copyFileName(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        copyText(url.lastPathComponent)
    }
    @objc private func renameFile(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        // 等右键菜单结束跟踪后再显示输入框。
        DispatchQueue.main.async { [weak self] in self?.promptRename(url) }
    }
    private func promptRename(_ url: URL) {
        let alert = NSAlert()
        alert.messageText = "重命名文件"
        alert.informativeText = "输入新的文件名（包含扩展名）："
        alert.addButton(withTitle: "重命名")
        alert.addButton(withTitle: "取消").keyEquivalent = "\u{1b}"
        let input = RenameTextField(string: url.lastPathComponent)
        input.frame = NSRect(x: 0, y: 0, width: 340, height: 24)
        input.setAccessibilityLabel("新文件名")
        alert.accessoryView = input
        alert.window.initialFirstResponder = input
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            _ = try sidebarURL(path: url.path)
            try renameFile(at: url, to: input.stringValue)
        } catch { showError(error) }
    }
    func renameDocument(to name: String) throws {
        guard let url = fileURL else { throw CocoaError(.fileNoSuchFile) }
        try renameFile(at: url, to: name)
    }
    private func renameFile(at url: URL, to proposedName: String) throws {
        let name = proposedName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name != ".", name != "..", !name.contains("/"), !name.contains(":"), !name.contains("\0"), !name.contains("\n"), !name.contains("\r") else {
            throw CocoaError(.fileWriteInvalidFileName, userInfo: [NSLocalizedDescriptionKey: "请输入有效的文件名，不要包含路径分隔符、冒号或换行。"])
        }
        let destination = url.deletingLastPathComponent().appendingPathComponent(name)
        guard destination != url else { return }
        if (NSApp.delegate as? AppDelegate)?.isBusyWithFile(at: url) == true {
            throw CocoaError(.fileWriteUnknown, userInfo: [NSLocalizedDescriptionKey: "文件正在读取或保存，请操作完成后再重试重命名。"])
        }
        // moveItem遇到同名目标会失败，不覆盖现有文件。
        try FileManager.default.moveItem(at: url, to: destination)
        (NSApp.delegate as? AppDelegate)?.fileWasRenamed(from: url, to: destination)
    }
    func chooseFolder() -> Bool {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        panel.prompt = "打开文件夹"
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        folderURL = url
        bridge?.emit("file.listChanged")
        return true
    }
    func listFiles(path: String?) throws -> JSONValue {
        let root = folderURL ?? fileURL?.deletingLastPathComponent()
        guard let root else { return .object(["name": .string("未打开文件夹"), "items": .array([])]) }
        let requested = path.map { URL(fileURLWithPath: $0).standardizedFileURL } ?? root
        let resolvedRoot = root.resolvingSymlinksInPath().path
        let resolved = requested.resolvingSymlinksInPath().path
        guard resolved == resolvedRoot || resolved.hasPrefix(resolvedRoot + "/") else { throw CocoaError(.fileReadNoPermission) }
        let urls = try FileManager.default.contentsOfDirectory(at: requested, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles])
        let items: [(URL, Bool)] = try urls.compactMap { url in
            let directory = try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true
            guard directory || supportedTextExtensions.contains(url.pathExtension.lowercased()) else { return nil }
            return (url, directory)
        }.sorted { a, b in a.1 != b.1 ? a.1 : a.0.lastPathComponent.localizedStandardCompare(b.0.lastPathComponent) == .orderedAscending }
        return .object(["name": .string(requested.lastPathComponent), "items": .array(items.map { url, directory in .object(["name": .string(url.lastPathComponent), "path": .string(url.path), "directory": .bool(directory), "active": .bool(url == self.fileURL)]) })])
    }
    func openLink(_ href: String) {
        if let url = URL(string: href), ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url); return }
        guard let base = fileURL else { return }
        let url = URL(string: href, relativeTo: base)?.absoluteURL ?? base.deletingLastPathComponent().appendingPathComponent(href)
        if supportedTextExtensions.contains(url.pathExtension.lowercased()) { openDocument(at: url) }
        else { NSWorkspace.shared.open(url) }
    }
    private static func readText(_ url: URL) throws -> String {
        let data = try Data(contentsOf: url)
        if let text = String(data: data, encoding: .utf8) { return text }
        var encoding = String.Encoding.utf8
        return try String(contentsOf: url, usedEncoding: &encoding)
    }
    private func showError(_ error: Error) { NSAlert(error: error).runModal() }
    private func showMessage(_ title: String, detail: String) { let alert = NSAlert(); alert.messageText = title; alert.informativeText = detail; alert.runModal() }
}
