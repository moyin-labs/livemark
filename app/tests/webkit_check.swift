import AppKit
import WebKit

final class Runner: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    var webView: WKWebView!
    var window: NSWindow!
    var ready = false
    let resources = ResourceHandler()
    func start() {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "livemark")
        configuration.setURLSchemeHandler(resources, forURLScheme: "livemark-resource")
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1120, height: 760), configuration: configuration)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: webView.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = webView
        let entry = root.appendingPathComponent("app/Sources/LiveMark/Resources/WebKernel/index.html")
        webView.loadFileURL(entry, allowingReadAccessTo: entry.deletingLastPathComponent())
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { fputs("WKWebView test timed out\n", stderr); exit(1) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], body["name"] as? String == "app.ready", !ready else { return }
        ready = true
        runChecks()
    }
    func runChecks() {
        let fixture = root.appendingPathComponent("app/tests/fixtures/ui_fixture.md")
        resources.root = fixture.deletingLastPathComponent()
        let text = (try? String(contentsOf: fixture, encoding: .utf8)) ?? ""
        let script = """
        await window.__livemark.handlers.get('file.read')({content, path, documentID:'wk-test', generation:1});
        await new Promise(resolve => setTimeout(resolve, 1500));
        const pm = document.querySelector('.ProseMirror');
        const image = pm.querySelector('img');
        const before = await window.__livemark.handlers.get('file.save')();
        const results = {
          renderer: !!pm,
          tables: pm.querySelectorAll('table tr').length === 2,
          tasks: pm.querySelectorAll('li.task-item').length === 2,
          formula: !!pm.querySelector('.katex'),
          diagram: !!pm.querySelector('.visual-result svg'),
          localImage: !!image && image.complete && image.naturalWidth > 0,
          untouched: before.content === content && before.dirty === false
        };
        pm.querySelector('li.task-item input').click();
        results.taskSave = (await window.__livemark.handlers.get('file.save')()).content.includes('[x] 待办任务');
        await window.__livemark.handlers.get('editor.command')({command:'undo'});
        results.undoClean = (await window.__livemark.handlers.get('file.save')()).dirty === false;
        await window.__livemark.handlers.get('file.read')({content:'', path:'', documentID:'wk-new', generation:1});
        await window.__livemark.handlers.get('editor.command')({command:'undo'});
        results.historyIsolation = (await window.__livemark.handlers.get('file.save')()).content === '';
        return results;
        """
        webView.callAsyncJavaScript(script, arguments: ["content": text, "path": fixture.path], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                guard let checks = value as? [String: Bool] else { print("Unexpected test result: \(value)"); exit(1) }
                let data = try! JSONSerialization.data(withJSONObject: checks, options: [.prettyPrinted, .sortedKeys])
                try? data.write(to: self.root.appendingPathComponent("app/.build/ui_validation/webkit_results.json"))
                print(String(data: data, encoding: .utf8)!)
                exit(checks.values.allSatisfy { $0 } ? 0 : 1)
            case .failure(let error): print("WKWebView error: \(error)"); exit(1)
            }
        }
    }
}
@main struct Main {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let runner = Runner()
        runner.start()
        application.run()
        withExtendedLifetime(runner) {}
    }
}
