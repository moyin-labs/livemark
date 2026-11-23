import Foundation
import CoreFoundation

/// 协议信封(契约 v1 §2)。字段与 kernel-src/src/bridge.ts 的 Envelope 一一对应,
/// 改字段必须两侧同步并登记 docs/桥接协议.md。
struct Envelope: Codable {
    /// "__livemark" 协议版本标记(CodingKeys 映射)
    var livemark: Int
    var type: String          // "call" | "response" | "event"
    var id: String?
    var handler: String?
    var data: JSONValue?
    var ok: Bool?
    var error: String?
    var name: String?

    enum CodingKeys: String, CodingKey {
        case livemark = "__livemark"
        case type, id, handler, data, ok, error, name
    }

    static func call(id: String, handler: String, data: JSONValue) -> Envelope {
        Envelope(livemark: 1, type: "call", id: id, handler: handler, data: data)
    }

    static func response(id: String, ok: Bool, data: JSONValue? = nil, error: String? = nil) -> Envelope {
        Envelope(livemark: 1, type: "response", id: id, data: data, ok: ok, error: error)
    }

    static func event(name: String, data: JSONValue = .null) -> Envelope {
        Envelope(livemark: 1, type: "event", data: data, name: name)
    }
}

/// 任意 JSON 值(WKScriptMessage body → Codable 的桥)。
/// 契约规定 call 的 data 必为 JSON 对象, 但信封层保持通用。
enum JSONValue: Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let b = try? container.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? container.decode(Double.self) {
            self = .number(n)
        } else if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let a = try? container.decode([JSONValue].self) {
            self = .array(a)
        } else if let o = try? container.decode([String: JSONValue].self) {
            self = .object(o)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let b): try container.encode(b)
        case .number(let n): try container.encode(n)
        case .string(let s): try container.encode(s)
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }

    // ---- 便捷读取 ----

    var stringValue: String? { if case .string(let s) = self { return s }; return nil }
    var boolValue: Bool? { if case .bool(let b) = self { return b }; return nil }
    var numberValue: Double? { if case .number(let n) = self { return n }; return nil }
    var objectValue: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    var arrayValue: [JSONValue]? { if case .array(let a) = self { return a }; return nil }

    subscript(key: String) -> JSONValue? { objectValue?[key] }

    /// 任意 Foundation 对象(WKScriptMessage.body) → JSONValue
    static func from(_ any: Any) -> JSONValue {
        switch any {
        case is NSNull: return .null
        // Foundation允许NSNumber(0/1)转为Bool；必须按实际CF类型区分，
        // 否则文档generation=1和revision=1会被误读，导致载入回执失效。
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            return .number(n.doubleValue)
        case let s as String: return .string(s)
        case let a as [Any]: return .array(a.map(from))
        case let o as [String: Any]:
            var result: [String: JSONValue] = [:]
            for (k, v) in o { result[k] = from(v) }
            return .object(result)
        default: return .null
        }
    }
}
