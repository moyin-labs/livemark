import Foundation

enum FontManager {
    static let options: [(id: String, title: String)] = [
        ("ptserif", "PT Serif（Typora）"),
        ("theme", "跟随主题"),
        ("system", "macOS默认"),
        ("pingfang", "苹方"),
        ("songti", "宋体"),
        ("kaiti", "楷体"),
        ("mono", "等宽（Menlo）"),
    ]
    static let names = options.map(\.id)
    private static let key = "livemark.font"
    static var current: String {
        get {
            let value = UserDefaults.standard.string(forKey: key) ?? "ptserif"
            return names.contains(value) ? value : "ptserif"
        }
        set { if names.contains(newValue) { UserDefaults.standard.set(newValue, forKey: key) } }
    }
}
