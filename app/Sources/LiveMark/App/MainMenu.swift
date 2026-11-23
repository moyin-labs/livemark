import AppKit

enum MainMenu {
    private static var recentMenu: NSMenu?
    static func noteRecent(_ url: URL) {
        NSDocumentController.shared.noteNewRecentDocumentURL(url)
        var paths = UserDefaults.standard.stringArray(forKey: "livemark.recentFiles") ?? []
        paths.removeAll { $0 == url.path }
        paths.insert(url.path, at: 0)
        UserDefaults.standard.set(Array(paths.prefix(15)), forKey: "livemark.recentFiles")
        refreshRecents()
    }
    static func renameRecent(from oldURL: URL, to newURL: URL) {
        let paths = UserDefaults.standard.stringArray(forKey: "livemark.recentFiles") ?? []
        UserDefaults.standard.set(paths.filter { URL(fileURLWithPath: $0).standardizedFileURL != oldURL.standardizedFileURL }, forKey: "livemark.recentFiles")
        noteRecent(newURL)
    }
    private static func refreshRecents() {
        guard let menu = recentMenu else { return }
        menu.removeAllItems()
        for path in UserDefaults.standard.stringArray(forKey: "livemark.recentFiles") ?? [] {
            let entry = item(URL(fileURLWithPath: path).lastPathComponent, #selector(AppDelegate.openRecent(_:)), target: NSApp.delegate)
            entry.representedObject = path
            entry.toolTip = path
            menu.addItem(entry)
        }
        if menu.items.isEmpty { let empty = NSMenuItem(title: "无最近文档", action: nil, keyEquivalent: ""); menu.addItem(empty) }
    }
    private static func item(_ title: String, _ action: Selector, _ key: String = "", modifiers: NSEvent.ModifierFlags = [.command], command: String? = nil, target: AnyObject? = nil) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key)
        result.keyEquivalentModifierMask = modifiers
        result.representedObject = command
        result.target = target
        return result
    }
    private static func command(_ title: String, _ command: String, _ key: String = "", modifiers: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
        item(title, #selector(MainWindowController.editorCommand(_:)), key, modifiers: modifiers, command: command)
    }
    static func install() {
        let main = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) { let root = NSMenuItem(); let menu = NSMenu(title: title); menu.items = items; root.submenu = menu; main.addItem(root) }
        add("LiveMark", [item("关于LiveMark", #selector(NSApplication.orderFrontStandardAboutPanel(_:))), .separator(), item("隐藏LiveMark", #selector(NSApplication.hide(_:)), "h"), item("隐藏其他", #selector(NSApplication.hideOtherApplications(_:)), "h", modifiers: [.command, .option]), .separator(), item("退出LiveMark", #selector(NSApplication.terminate(_:)), "q")])
        add("文件", [
            item("新建", #selector(AppDelegate.newDocument(_:)), "n", target: NSApp.delegate), item("打开…", #selector(AppDelegate.openDocumentPanel(_:)), "o", target: NSApp.delegate), item("打开文件夹…", #selector(MainWindowController.openFolder(_:)), "o", modifiers: [.command, .shift]),
            .separator(), item("关闭", #selector(NSWindow.performClose(_:)), "w"), item("保存", #selector(MainWindowController.saveDocument(_:)), "s"), item("另存为…", #selector(MainWindowController.saveDocumentAs(_:)), "s", modifiers: [.command, .shift]), item("重命名…", #selector(MainWindowController.showDocumentRename(_:))), .separator(), item("导出HTML…", #selector(MainWindowController.exportHTML(_:)), "e", modifiers: [.command, .shift]), item("打印…", #selector(MainWindowController.printDocument(_:)), "p"),
        ])
        if let fileMenu = main.items[1].submenu {
            let root = NSMenuItem(title: "打开最近使用", action: nil, keyEquivalent: "")
            let menu = NSMenu(title: "打开最近使用")
            root.submenu = menu
            recentMenu = menu
            fileMenu.insertItem(root, at: 3)
            refreshRecents()
        }
        add("编辑", [
            command("撤销", "undo", "z"), command("重做", "redo", "z", modifiers: [.command, .shift]), .separator(), item("剪切", #selector(NSText.cut(_:)), "x"), item("拷贝", #selector(NSText.copy(_:)), "c"), item("粘贴", #selector(NSText.paste(_:)), "v"), item("粘贴并匹配样式", #selector(NSTextView.pasteAsPlainText(_:)), "v", modifiers: [.command, .option, .shift]), item("全选", #selector(AppDelegate.selectAllDocument(_:)), "a", target: NSApp.delegate), .separator(), command("查找…", "find", "f"), command("查找并替换…", "replace", "f", modifiers: [.command, .shift]),
        ])
        var paragraphs: [NSMenuItem] = []
        for level in 1...6 { paragraphs.append(command("\(level)级标题", "heading\(level)", String(level))) }
        paragraphs += [.separator(), command("正文", "paragraph", "0"), command("提升一级", "headingUp", "=", modifiers: [.command]), command("降低一级", "headingDown", "-", modifiers: [.command]), .separator(), command("表格…", "table", "t", modifiers: [.command, .option]), command("代码块", "codeblock", "k", modifiers: [.command, .option]), command("公式块", "mathblock", "m", modifiers: [.command, .option]), command("引用", "quote", "q", modifiers: [.command, .option]), .separator(), command("有序列表", "ordered", "o", modifiers: [.command, .option]), command("无序列表", "bullet", "u", modifiers: [.command, .option]), command("任务列表", "task", "x", modifiers: [.command, .option]), .separator(), command("水平分割线", "hr", "-", modifiers: [.command, .shift]), command("Mermaid图表", "mermaid")]
        add("段落", paragraphs)
        add("格式", [command("粗体", "bold", "b"), command("斜体", "italic", "i"), command("下划线", "underline", "u"), command("行内代码", "code", "e"), command("删除线", "strike", "x", modifiers: [.command, .shift]), command("高亮", "highlight", "h", modifiers: [.command, .shift]), .separator(), command("超链接…", "link", "k"), command("图像…", "image", "i", modifiers: [.command, .control]), command("行内公式…", "math"), .separator(), command("清除块格式", "paragraph", "0", modifiers: [.command, .option])])
        add("显示", [command("大纲", "outline", "1", modifiers: [.command, .shift]), command("文件树", "files", "2", modifiers: [.command, .shift]), command("切换侧栏", "sidebar", "l", modifiers: [.command, .shift]), .separator(), command("源码模式", "source", "/"), command("即时编辑", "live"), command("只读预览", "preview"), .separator(), command("专注模式", "focus", "j", modifiers: [.command, .shift]), command("打字机模式", "typewriter", "t", modifiers: [.command, .shift]), .separator(), item("进入全屏", #selector(NSWindow.toggleFullScreen(_:)), "f", modifiers: [.command, .control])])
        let fonts = FontManager.options.map { option -> NSMenuItem in
            let value = item(option.title, #selector(MainWindowController.selectFont(_:)))
            value.representedObject = option.id
            return value
        }
        add("字体", fonts)
        let themes = ThemeManager.names.map { name -> NSMenuItem in let value = item(name.prefix(1).uppercased() + name.dropFirst(), #selector(MainWindowController.selectTheme(_:))); value.representedObject = name; return value }
        add("主题", themes)
        add("窗口", [item("最小化", #selector(NSWindow.performMiniaturize(_:)), "m"), item("缩放", #selector(NSWindow.performZoom(_:))), .separator(), item("全部置于前面", #selector(NSApplication.arrangeInFront(_:)))])
        NSApp.mainMenu = main
        NSApp.windowsMenu = main.items.last?.submenu
        // 将旧版本的最近文档迁移至系统记录，供Dock显示。
        let documentController = NSDocumentController.shared
        if documentController.recentDocumentURLs.isEmpty {
            for path in (UserDefaults.standard.stringArray(forKey: "livemark.recentFiles") ?? []).reversed() {
                if FileManager.default.fileExists(atPath: path) { documentController.noteNewRecentDocumentURL(URL(fileURLWithPath: path)) }
            }
        }
    }
}
