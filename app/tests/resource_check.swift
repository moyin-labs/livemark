import Foundation
import WebKit
@main struct ResourceCheck {
    static func main() throws {
        let handler = ResourceHandler()
        let folder = URL(fileURLWithPath: CommandLine.arguments[1])
        handler.root = folder
        let result = try handler.dataURL("./sample.svg")
        precondition(result.hasPrefix("data:image/svg+xml;base64,"))
        let payload = result.split(separator: ",", maxSplits: 1)[1]
        let expected = try Data(contentsOf: folder.appendingPathComponent("sample.svg"))
        precondition(Data(base64Encoded: String(payload)) == expected)
        do { _ = try handler.dataURL("../resource_check.swift"); fatalError("Path escape accepted") }
        catch { print("parent directory denied: PASS") }
        do { _ = try handler.dataURL("https://example.com/private.svg"); fatalError("Remote URL accepted") }
        catch { print("remote URL denied: PASS") }
        handler.root = nil
        do { _ = try handler.dataURL("sample.svg"); fatalError("Missing root accepted") }
        catch { print("missing document root denied: PASS") }
        print("local image data URL: PASS")
    }
}
