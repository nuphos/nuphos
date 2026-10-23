import Foundation

/// A successful thread receipt stays visible beside the narration, like Desktop.
struct ThreadReference: Equatable {
    let id: String
    let title: String?
    let verb: String

    init?(_ part: ChatPart.ToolPart) {
        guard ["create_thread", "send_message_to_thread"].contains(part.toolName),
              part.state == .outputAvailable,
              let id = Self.validID(part.input?["threadId"]) ?? Self.validID(Self.receipt(part.output)?["threadId"]) else { return nil }
        self.id = id
        let title = part.input?["title"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        self.title = title?.isEmpty == false ? title : nil
        verb = part.toolName == "create_thread" ? "Started" : "Messaged"
    }

    private static func validID(_ value: JSONValue?) -> String? {
        guard let id = value?.stringValue, UUID(uuidString: id) != nil else { return nil }
        return id
    }

    private static func receipt(_ value: JSONValue?) -> JSONValue? {
        if let text = value?.stringValue { return JSONValue.parse(text) }
        if let items = value?.arrayValue {
            return receipt(items.first { $0["type"]?.stringValue == "text" }?["text"])
        }
        return value
    }
}
