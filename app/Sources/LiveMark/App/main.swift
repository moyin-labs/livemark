import AppKit

// LiveMark 入口。SwiftPM executableTarget 没有 MainMenu.nib, 手动启动 NSApplication。
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
