/**
 * LiveMark bridge — 内核侧。
 * 协议: docs/桥接协议.md（消息格式与握手时序）。
 *
 * 通道:
 *   JS→N  window.webkit.messageHandlers.livemark.postMessage(envelope)
 *   N→JS  native evaluateJavaScript("window.__livemark.dispatch(<json>)")
 *
 * 双向消息分发方式：
 *   - 无 callSync(全部异步 + id 配对)
 *   - call/response/event 显式分型
 *   - app.ready 前 native 调用由 native 侧排队, 内核无需 whenReady 机制
 */

export const PROTOCOL_VERSION = 1;
export const KERNEL_VERSION = "0.2.0";

interface Envelope {
  __livemark: number;
  type: "call" | "response" | "event";
  id?: string;
  handler?: string;
  data?: any;
  ok?: boolean;
  error?: string;
  name?: string;
}

type Handler = (data: any) => any | Promise<any>;
type EventListener = (data: any) => void;

interface WebKitBridge {
  messageHandlers: {
    livemark: { postMessage(envelope: Envelope): void };
  };
}

declare global {
  interface Window {
    webkit?: WebKitBridge;
    __livemark?: Bridge;
  }
}

const CALL_TIMEOUT_MS = 5000;

export class Bridge {
  private handlers = new Map<string, Handler>();
  private listeners = new Map<string, Set<EventListener>>();
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: number;
    }
  >();
  private counter = 0;
  private transport: WebKitBridge | null;

  constructor() {
    this.transport =
      typeof window !== "undefined" && window.webkit ? window.webkit : null;
    if (!this.transport) {
      // 非 WKWebView 环境(如浏览器调试): 打日志不崩
      console.warn(
        "[livemark] no webkit.messageHandlers.livemark — calls will time out",
      );
    }
  }

  /** 注册内核能力供 native 调用(N→JS call 的接收端) */
  registerHandler(name: string, fn: Handler): void {
    this.handlers.set(name, fn);
  }

  /** 监听 native 发来的 event(如 file.writeDone) */
  onEvent(name: string, listener: EventListener): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  /** 调用 native 能力(JS→N)。返回 Promise, 5s 超时。 */
  callHandler(name: string, data: Record<string, unknown> = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `j-${++this.counter}`;
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`bridge call "${name}" timed out (${CALL_TIMEOUT_MS}ms)`),
        );
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({
        __livemark: PROTOCOL_VERSION,
        type: "call",
        id,
        handler: name,
        data,
      });
    });
  }

  /** 发事件给 native(即发即弃) */
  emit(name: string, data: Record<string, unknown> = {}): void {
    this.send({ __livemark: PROTOCOL_VERSION, type: "event", name, data });
  }

  /** native→JS 入口(native 侧 evaluateJavaScript 调这里) */
  dispatch(env: Envelope): void {
    if (!env || env.__livemark !== PROTOCOL_VERSION) return; // 未知版本: 丢弃(契约 §1)
    switch (env.type) {
      case "call": {
        this.handleNativeCall(env).catch((err) => {
          console.error(`[livemark] handler "${env.handler}" threw:`, err);
        });
        break;
      }
      case "response": {
        this.resolvePending(env);
        break;
      }
      case "event": {
        this.fireLocalEvent(env);
        break;
      }
    }
  }

  // ---- 内部 ----

  private send(env: Envelope): void {
    if (!this.transport) {
      console.log(
        "[livemark] (no transport) send:",
        env.type,
        env.handler ?? env.name,
      );
      return;
    }
    this.transport.messageHandlers.livemark.postMessage(env);
  }

  private async handleNativeCall(env: Envelope): Promise<void> {
    const id = env.id ?? "";
    const handler = env.handler ? this.handlers.get(env.handler) : undefined;
    if (!handler) {
      // 未注册 handler: 按契约回 ok=false(而不是静默), 方便 native 侧发现协议漂移
      this.send({
        __livemark: PROTOCOL_VERSION,
        type: "response",
        id,
        ok: false,
        error: `no handler registered: ${env.handler}`,
      });
      return;
    }
    try {
      const result = await handler(env.data ?? {});
      this.send({
        __livemark: PROTOCOL_VERSION,
        type: "response",
        id,
        ok: true,
        data: result ?? {},
      });
    } catch (err: any) {
      this.send({
        __livemark: PROTOCOL_VERSION,
        type: "response",
        id,
        ok: false,
        error: err?.message ?? String(err),
      });
    }
  }

  private resolvePending(env: Envelope): void {
    const entry = env.id ? this.pending.get(env.id) : undefined;
    if (!entry) return; // 未知/已超时的 response: 丢弃
    this.pending.delete(env.id!);
    window.clearTimeout(entry.timer);
    if (env.ok) entry.resolve(env.data ?? {});
    else entry.reject(new Error(env.error ?? "native call failed"));
  }

  private fireLocalEvent(env: Envelope): void {
    const set = env.name ? this.listeners.get(env.name) : undefined;
    if (!set) return;
    for (const listener of set) {
      try {
        listener(env.data ?? {});
      } catch (err) {
        console.error(`[livemark] event listener "${env.name}" threw:`, err);
      }
    }
  }
}
