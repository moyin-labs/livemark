import os

/// 统一日志出口(os_log)。bridge 流量在 M4 起全部过这里, 便于 Console.app 过滤。
enum Log {
    private static let subsystem = "com.ainativelab.livemark"

    static let bridge = Logger(subsystem: subsystem, category: "bridge")
    static let file = Logger(subsystem: subsystem, category: "file")
    static let app = Logger(subsystem: subsystem, category: "app")

    /// 菜单/动作流水(占位动作也记录, 便于 milestone 验证)
    static func menu(_ msg: String) {
        app.info("menu: \(msg, privacy: .public)")
    }
}
