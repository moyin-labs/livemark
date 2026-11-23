import Foundation
import WebKit
import UniformTypeIdentifiers

/// 文档目录资源通过自定义scheme读取，不扩大内核file://页面的读取权限。
final class ResourceHandler: NSObject, WKURLSchemeHandler {
    var root: URL?
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == "file", let root else {
            urlSchemeTask.didFailWithError(CocoaError(.fileReadNoPermission)); return
        }
        let file = URL(fileURLWithPath: url.path).resolvingSymlinksInPath()
        let folder = root.resolvingSymlinksInPath().path
        guard file.path.hasPrefix(folder + "/") else { urlSchemeTask.didFailWithError(CocoaError(.fileReadNoPermission)); return }
        do {
            let data = try Data(contentsOf: file)
            let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
            urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
        } catch { urlSchemeTask.didFailWithError(error) }
    }
    func dataURL(_ source: String) throws -> String {
        guard let root else { throw CocoaError(.fileReadNoPermission) }
        let base = root.appendingPathComponent("document.md")
        guard let url = URL(string: source, relativeTo: base)?.absoluteURL, url.isFileURL else { throw CocoaError(.fileReadNoPermission) }
        let resolved = url.resolvingSymlinksInPath()
        guard resolved.path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else { throw CocoaError(.fileReadNoPermission) }
        let data = try Data(contentsOf: resolved)
        let mime = UTType(filenameExtension: resolved.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        return "data:\(mime);base64,\(data.base64EncodedString())"
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
