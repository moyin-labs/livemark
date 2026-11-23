import Foundation
import WebKit

/// LiveMark bridge — native 侧。协议: docs/桥接协议.md。
///
/// 双向 handler 注册表使用异步消息和 ID 配对。
/// 无 callSync。app.ready 前的 N→JS 消息进 outboundQueue, ready 后冲刷(契约 §4)。
typealias BridgeHandler = (_ data: JSONValue) async throws -> JSONValue
typealias BridgeEventListener = (_ data: JSONValue) -> Void

final class Bridge: NSObject, WKScriptMessageHandler {

    private var handlers: [String: BridgeHandler] = [:]
    private var eventListeners: [String: [BridgeEventListener]] = [:]
    private var pending: [String: (Result<JSONValue, Error>) -> Void] = [:]
    private var outboundQueue: [Envelope] = []
    private var counter = 0
    private var ready = false
    private weak var webView: WKWebView?

    /// 挂到 WKWebView: 注册 "livemark" messageHandler(JS→N 通道入口)
    func attach(to webView: WKWebView) {
        self.webView = webView
        webView.configuration.userContentController.add(self, name: "livemark")
    }

    func detach() {
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "livemark")
        handlers.removeAll()
        eventListeners.removeAll()
        outboundQueue.removeAll()
        let callbacks = Array(pending.values)
        pending.removeAll()
        ready = false
        for callback in callbacks { callback(.failure(BridgeError.remote("文档已关闭"))) }
    }

    // MARK: - 注册(native 能力, 供 JS 调用)

    func registerHandler(_ name: String, _ handler: @escaping BridgeHandler) {
        handlers[name] = handler
    }

    /// 监听 JS 发来的 event(如 file.contentChanged)
    func onEvent(_ name: String, listener: @escaping BridgeEventListener) {
        eventListeners[name, default: []].append(listener)
    }

    // MARK: - 主动调用(N→JS)

    func callHandler(_ name: String,
                     data: JSONValue = .object([:]),
                     completion: ((Result<JSONValue, Error>) -> Void)? = nil) {
        counter += 1
        let id = "n-\(counter)"
        let envelope = Envelope.call(id: id, handler: name, data: data)
        if let completion {
            pending[id] = completion
            let timeout: TimeInterval = name.hasPrefix("export.") ? 60 : 8
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                guard let callback = self?.pending.removeValue(forKey: id) else { return }
                callback(.failure(BridgeError.remote("编辑器响应超时：\(name)")))
            }
        }
        send(envelope)
    }

    func emit(_ name: String, data: JSONValue = .object([:])) {
        send(Envelope.event(name: name, data: data))
    }

    // MARK: - JS→N 入口

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        guard let dict = message.body as? [String: Any],
              let livemark = dict["__livemark"] as? Int, livemark == 1,
              let type = dict["type"] as? String else {
            Log.bridge.error("dropping malformed message: \(String(describing: message.body), privacy: .public)")
            return
        }
        switch type {
        case "event":
            guard let name = dict["name"] as? String else { return }
            let data = JSONValue.from(dict["data"] ?? NSNull())
            handleEvent(name: name, data: data)
        case "call":
            guard let id = dict["id"] as? String,
                  let handlerName = dict["handler"] as? String else { return }
            let data = JSONValue.from(dict["data"] ?? NSNull())
            handleCall(id: id, handlerName: handlerName, data: data)
        case "response":
            guard let id = dict["id"] as? String else { return }
            let ok = dict["ok"] as? Bool ?? false
            let data = JSONValue.from(dict["data"] ?? NSNull())
            let error = dict["error"] as? String
            resolvePending(id: id, ok: ok, data: data, error: error)
        default:
            Log.bridge.error("unknown message type: \(type, privacy: .public)")
        }
    }

    // MARK: - 内部

    private func handleEvent(name: String, data: JSONValue) {
        if name == "app.ready" {
            let version = data["kernelVersion"]?.stringValue ?? "?"
            Log.bridge.info("app.ready (kernel \(version, privacy: .public))")
            ready = true
            flushQueue()
        }
        for listener in eventListeners[name] ?? [] {
            listener(data)
        }
    }

    private func handleCall(id: String, handlerName: String, data: JSONValue) {
        let start = CFAbsoluteTimeGetCurrent()
        guard let handler = handlers[handlerName] else {
            // 契约: 未注册 handler 回 ok=false, 暴露协议漂移
            Log.bridge.error("no handler: \(handlerName, privacy: .public)")
            send(Envelope.response(id: id, ok: false, error: "no native handler: \(handlerName)"))
            return
        }
        Task { @MainActor in
            do {
                let result = try await handler(data)
                let elapsed = Int((CFAbsoluteTimeGetCurrent() - start) * 1000)
                Log.bridge.info("call \(handlerName, privacy: .public) ← id=\(id, privacy: .public) (\(elapsed)ms)")
                self.send(Envelope.response(id: id, ok: true, data: result))
            } catch {
                Log.bridge.error("handler \(handlerName, privacy: .public) threw: \(error.localizedDescription, privacy: .public)")
                self.send(Envelope.response(id: id, ok: false, error: error.localizedDescription))
            }
        }
    }

    private func resolvePending(id: String, ok: Bool, data: JSONValue, error: String?) {
        guard let completion = pending.removeValue(forKey: id) else { return }
        if ok {
            completion(.success(data))
        } else {
            completion(.failure(BridgeError.remote(error ?? "native call failed")))
        }
    }

    private func send(_ envelope: Envelope) {
        // app.ready 前的 N→JS 消息排队(桥接协议 §4)
        guard ready, let webView else {
            outboundQueue.append(envelope)
            return
        }
        guard let json = try? JSONEncoder().encode(envelope),
              let jsonText = String(data: json, encoding: .utf8) else {
            Log.bridge.error("envelope encode failed: \(String(describing: envelope.type), privacy: .public)")
            return
        }
        // JSON 文本即合法 JS 对象字面量(ES2019+), 直接内插。U+2028/2029 在现代 WebKit 无碍。
        let handlerName = envelope.handler ?? envelope.name ?? "?"
        Log.bridge.debug("dispatch \(handlerName, privacy: .public) scriptLen=\(jsonText.utf16.count)")
        webView.evaluateJavaScript("window.__livemark?.dispatch(\(jsonText))") { _, error in
            if let error {
                Log.bridge.error("dispatch failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func flushQueue() {
        let queued = outboundQueue
        outboundQueue.removeAll()
        for envelope in queued {
            send(envelope)
        }
    }
}

enum BridgeError: LocalizedError {
    case remote(String)
    var errorDescription: String? {
        switch self {
        case .remote(let msg): return msg
        }
    }
}
