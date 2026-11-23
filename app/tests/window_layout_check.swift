import AppKit

@main
struct WindowLayoutCheck {
    static func main() {
        let name = "LiveMark.WindowLayoutCheck.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        precondition(WindowLayout.rememberedSize(defaults: defaults) == NSSize(width: 1512, height: 869))
        WindowLayout.remember(NSSize(width: 1240, height: 720), defaults: defaults)
        precondition(WindowLayout.rememberedSize(defaults: UserDefaults(suiteName: name)!) == NSSize(width: 1240, height: 720))
        WindowLayout.remember(NSSize(width: CGFloat.nan, height: 900), defaults: defaults)
        precondition(WindowLayout.rememberedSize(defaults: defaults).width == 1240)
        defaults.set("{0, 0}", forKey: "window.frameSize")
        precondition(WindowLayout.rememberedSize(defaults: defaults) == WindowLayout.defaultSize)
        let screen = NSRect(x: -1280, y: 25, width: 1280, height: 775)
        let large = WindowLayout.fittedFrame(size: NSSize(width: 3000, height: 2000), topLeft: NSPoint(x: 100, y: 900), visibleFrame: screen)
        precondition(large == screen)
        let normal = WindowLayout.fittedFrame(size: NSSize(width: 900, height: 600), topLeft: NSPoint(x: -1200, y: 760), visibleFrame: screen)
        precondition(normal == NSRect(x: -1200, y: 160, width: 900, height: 600))
        print("PASS: 默认尺寸、尺寸持久化、无效尺寸、小屏适配、多屏坐标、保留左上角")
    }
}
