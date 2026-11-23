import AppKit

enum WindowLayout {
    // LiveMark 默认文档窗口尺寸。
    static let defaultSize = NSSize(width: 1512, height: 869)
    static let minimumSize = NSSize(width: 600, height: 440)
    private static let sizeKey = "window.frameSize"

    static func rememberedSize(defaults: UserDefaults = .standard) -> NSSize {
        guard let value = defaults.string(forKey: sizeKey) else { return defaultSize }
        let size = NSSizeFromString(value)
        guard size.width.isFinite, size.height.isFinite,
              size.width >= minimumSize.width, size.height >= minimumSize.height else { return defaultSize }
        return size
    }

    static func remember(_ size: NSSize, defaults: UserDefaults = .standard) {
        guard size.width.isFinite, size.height.isFinite,
              size.width >= minimumSize.width, size.height >= minimumSize.height else { return }
        defaults.set(NSStringFromSize(size), forKey: sizeKey)
    }

    static func fittedFrame(size: NSSize, topLeft: NSPoint, visibleFrame: NSRect) -> NSRect {
        let width = min(max(size.width, minimumSize.width), visibleFrame.width)
        let height = min(max(size.height, minimumSize.height), visibleFrame.height)
        return NSRect(x: min(max(topLeft.x, visibleFrame.minX), visibleFrame.maxX - width),
                      y: min(max(topLeft.y - height, visibleFrame.minY), visibleFrame.maxY - height),
                      width: width, height: height)
    }
}
