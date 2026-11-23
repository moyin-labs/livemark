import Foundation

enum KernelResources {
    static var root: URL? {
        // 手工组装的macOS app把SwiftPM资源放在Contents/Resources中。
        // SwiftPM生成的Bundle.module优先探测app根目录，随后回落到构建机路径。
        if let packaged = Bundle.main.resourceURL?
            .appendingPathComponent("LiveMark_LiveMark.bundle/WebKernel"),
           FileManager.default.fileExists(atPath: packaged.appendingPathComponent("index.html").path) {
            return packaged
        }
        return Bundle.module.resourceURL?.appendingPathComponent("WebKernel")
    }
}
