import Foundation

/// Runtime message identities also identify replays; attachment is not a new turn.
enum RuntimeTranscript {
    static func autonomous(_ id: String, messages: inout [ChatMessage]) -> Int {
        if let index = messages.firstIndex(where: { $0.id == id }) { return index }
        var message = ChatMessage(id: id, role: .assistant, parts: [])
        message.turnOrigin = "autonomous"
        messages.append(message)
        return messages.count - 1
    }

    /// A run's first frame carries the user input that opened it. The sender
    /// keeps its own copy; any other device appends it, closing the previous
    /// answer. What followed it locally is rebuilt by the replay from frame 0.
    static func userTurn(_ input: [ChatMessage], messages: inout [ChatMessage]) {
        let users = input.filter { $0.role == .user }
        guard !users.isEmpty else { return }
        let ids = Set(users.map(\.id))
        let local = Dictionary(messages.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let kept = messages.firstIndex(where: { ids.contains($0.id) }).map { Array(messages[..<$0]) } ?? messages
        messages = kept + users.map { server in
            guard var value = local[server.id] else { return server }
            value.metadata = server.metadata
            return value
        }
    }

    /// A streamed assistant may still carry a temporary ID when a later turn
    /// appears in history. Its absolute slot and preceding user identify that
    /// turn without attaching its receipts to the new assistant.
    static func reconcile(server: [ChatMessage], serverBase: Int, local: [ChatMessage], localBase: Int) -> [ChatMessage] {
        let byId = Dictionary(local.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return server.enumerated().map { index, message in
            if let existing = byId[message.id], existing.role == message.role {
                return reconcile(server: message, local: existing)
            }
            let localIndex = serverBase + index - localBase
            guard message.role == .assistant, local.indices.contains(localIndex), local[localIndex].role == .assistant,
                  let serverUser = server.prefix(index).last(where: { $0.role == .user }),
                  let localUser = local.prefix(localIndex).last(where: { $0.role == .user }),
                  serverUser.id == localUser.id else { return message }
            return reconcile(server: message, local: local[localIndex])
        }
    }

    /// HTTP snapshots can lag stream delivery. Keep equivalent text/tool interleaving
    /// and acknowledged steering until the canonical transcript includes it.
    static func reconcile(server: ChatMessage, local: ChatMessage) -> ChatMessage {
        var result = server
        if local.text.hasPrefix(server.text) {
            result.parts = local.parts.compactMap { part in
                if case .tool(let tool) = part,
                   let canonical = server.parts.first(where: { if case .tool(let value) = $0 { return value.toolCallId == tool.toolCallId }; return false }) {
                    return canonical
                }
                if case .turnInterrupted(let interruption) = part,
                   !server.parts.contains(where: { if case .turnInterrupted(let value) = $0 { return value.id == interruption.id }; return false }) { return nil }
                return part
            }
            for part in server.parts {
                if case .text = part { continue }
                if case .reasoning = part, local.parts.contains(where: { if case .reasoning = $0 { return true }; return false }) { continue }
                if let index = result.parts.firstIndex(where: { sameIdentity($0, part) }) {
                    result.parts[index] = part
                } else { result.parts.append(part) }
            }
        }
        for part in local.parts {
            guard case .data(let receipt) = part, receipt.name == "steering" else { continue }
            if !result.parts.contains(where: { if case .data(let value) = $0 { return value.name == "steering" && value.data["id"] == receipt.data["id"] }; return false }) {
                result.parts.append(part)
            }
        }
        return result
    }

    private static func sameIdentity(_ lhs: ChatPart, _ rhs: ChatPart) -> Bool {
        switch (lhs, rhs) {
        case (.tool(let a), .tool(let b)): return a.toolCallId == b.toolCallId
        case (.data(let a), .data(let b)): return a.name == b.name && a.id == b.id && a.data["id"] == b.data["id"]
        case (.turnInterrupted(let a), .turnInterrupted(let b)): return a.id == b.id
        case (.other(let a), .other(let b)):
            return ["type", "id", "eventId", "turnKey"].allSatisfy { a[$0] == b[$0] }
        default: return lhs == rhs
        }
    }

    /// Adopts a conversation snapshot. An empty one is not an empty
    /// conversation — it is a snapshot that has nothing to say yet — and
    /// assigning it blanks the transcript until the replay refills it, which
    /// is what another device starting a turn used to look like here.
    static func adopt(
        snapshot: [ChatMessage],
        firstIndex: Int?,
        messages: inout [ChatMessage],
        baseIndex: inout Int
    ) {
        guard !snapshot.isEmpty else { return }
        messages = snapshot
        baseIndex = firstIndex ?? 0
    }

    /// The run to attach to. Output always lands in the conversation's newest
    /// run, so a transport still held by an older one has to move on.
    static func runToFollow(active: String?, attached: String?, stopped: String?) -> String? {
        guard let active, active != attached, active != stopped else { return nil }
        return active
    }

    /// The API acknowledgement and the stream receipt race; whichever lands
    /// second may be the one carrying the sender, so it fills that in.
    static func steering(id: String, text: String, metadata: JSONValue? = nil, messages: inout [ChatMessage]) {
        var data: [String: JSONValue] = ["id": .string(id), "text": .string(text)]
        if let metadata { data["metadata"] = metadata }
        for m in messages.indices {
            if let p = messages[m].parts.firstIndex(where: {
                if case .data(let value) = $0 { return value.name == "steering" && value.data["id"]?.stringValue == id }
                return false
            }) {
                if metadata != nil, case .data(let value) = messages[m].parts[p], value.data["metadata"] == nil {
                    messages[m].parts[p] = .data(.init(name: "steering", data: .object(data)))
                }
                return
            }
        }
        guard let index = messages.indices.last, messages[index].role == .assistant else { return }
        messages[index].parts.append(.data(.init(name: "steering", data: .object(data))))
    }
}
