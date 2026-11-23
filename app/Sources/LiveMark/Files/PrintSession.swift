import AppKit
import WebKit

/// 打印独立渲染的文档，避免把侧栏、源码视口或状态栏带入PDF。
final class PrintSession: NSObject, WKNavigationDelegate {
    private let webView: WKWebView
    private let completion: () -> Void
    init(html: String, completion: @escaping () -> Void) {
        self.completion = completion
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 760, height: 1000))
        super.init()
        webView.navigationDelegate = self
        webView.loadHTMLString(html, baseURL: nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        info.topMargin = 36; info.bottomMargin = 36
        info.leftMargin = 36; info.rightMargin = 36
        info.isHorizontallyCentered = true
        let operation = webView.printOperation(with: info)
        operation.showsPrintPanel = true
        operation.showsProgressPanel = true
        operation.run()
        completion()
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { NSAlert(error: error).runModal(); completion() }
}
