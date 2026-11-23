import AppKit

enum ThemeManager {
    private static let key = "livemark.theme"
    static let names = ["github", "gothic", "newsprint", "night", "pixyll", "whitey"]
    static var current: String {
        get {
            let value = UserDefaults.standard.string(forKey: key) ?? "newsprint"
            return value == "light" ? "newsprint" : value == "dark" ? "night" : names.contains(value) ? value : "newsprint"
        }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }
    static func set(_ name: String, bridge: Bridge?) {
        guard names.contains(name) else { return }
        current = name
        applyNativeAppearance()
        bridge?.callHandler("app.setTheme", data: .object(["theme": .string(name)]))
    }
    static func toggle(bridge: Bridge?) { set(current == "night" ? "newsprint" : "night", bridge: bridge) }
    /// 与WebKernel的--bg保持一致，透明标题栏直接延续窗口底色。
    static var backgroundColor: NSColor {
        let rgb: (CGFloat, CGFloat, CGFloat)
        switch current {
        case "newsprint": rgb = (246, 245, 241)
        case "night": rgb = (54, 59, 64)
        case "whitey": rgb = (250, 250, 250)
        default: rgb = (255, 255, 255)
        }
        return NSColor(srgbRed: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255, alpha: 1)
    }
    static func applyNativeAppearance() {
        NSApp.appearance = NSAppearance(named: current == "night" ? .darkAqua : .aqua)
        for window in NSApp.windows where window.windowController is MainWindowController {
            window.backgroundColor = backgroundColor
        }
    }
}
