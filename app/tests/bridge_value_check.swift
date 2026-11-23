import Foundation

@main struct BridgeValueCheck {
    static func main() throws {
        // 使用JSON反序列化模拟WKScriptMessage.body的Foundation值。
        let payload = try JSONSerialization.jsonObject(with: Data(
            #"{"generation":1,"revision":0,"dirty":false,"enabled":true,"fraction":1.5,"items":[0,1,false,true]}"#.utf8
        ))
        let value = JSONValue.from(payload)
        precondition(value["generation"]?.numberValue == 1)
        precondition(value["revision"]?.numberValue == 0)
        precondition(value["dirty"]?.boolValue == false)
        precondition(value["enabled"]?.boolValue == true)
        precondition(value["fraction"]?.numberValue == 1.5)
        let items = value["items"]!.arrayValue!
        precondition(items[0].numberValue == 0 && items[1].numberValue == 1)
        precondition(items[2].boolValue == false && items[3].boolValue == true)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
        precondition(decoded["generation"]?.numberValue == 1)
        precondition(decoded["dirty"]?.boolValue == false)
        print("bridge numeric/boolean fidelity: PASS")
    }
}
