import Foundation

/// A transcript message in the AI SDK v6 `UIMessage` shape. The JSON
/// encoding of this type is exactly what `POST /agent/chat` and
/// `PUT …/transcript` expect, so parts keep the SDK's field names.
struct ChatMessage: Identifiable, Equatable, Sendable {
    enum Role: String, Codable, Sendable { case user, assistant, system }

    var id: String
    var role: Role
    var parts: [ChatPart]
    var createdAt: Date?
    var metadata: JSONValue?
    /// Atlas extras carried through untouched.
    var turnOrigin: String?
    var stoppedByUser: Bool?
    var feedback: String?

    init(id: String = UUID().uuidString.lowercased(), role: Role, parts: [ChatPart], createdAt: Date? = .now) {
        self.id = id
        self.role = role
        self.parts = parts
        self.createdAt = createdAt
    }

    struct Sender: Equatable, Sendable {
        let name: String
        let avatar: URL?
    }

    var sender: Sender? {
        guard metadata?["version"]?.numberValue == 1,
              let name = metadata?["sender"]?["displayName"]?.stringValue, !name.isEmpty else { return nil }
        let raw = metadata?["sender"]?["avatarURL"]?.stringValue ?? ""
        let url = URL(string: raw)
        let trusted = url.flatMap { value -> URL? in
            guard raw.count <= 2048, value.scheme == "https", value.user == nil, value.password == nil, value.port == nil,
                  ["lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "lh6.googleusercontent.com"].contains(value.host ?? "") else { return nil }
            return value
        }
        return Sender(name: name, avatar: trusted)
    }

    var text: String {
        parts.compactMap { if case .text(let p) = $0 { return p.text }; return nil }.joined()
    }

    /// File-transfer instructions remain on the wire; the transcript shows filenames.
    var displayText: String {
        guard role == .user else { return text }
        return parts.compactMap { part -> String? in
            guard case .text(let value) = part else { return nil }
            let raw = value.text
            guard raw.hasPrefix("[The user uploaded "), raw.hasSuffix("./uploads]"),
                  let group = raw.range(of: "(transfer group "),
                  let start = raw.range(of: "): ", range: group.upperBound..<raw.endIndex),
                  let end = raw.range(of: ". To work with them, load the file-transfer skill", range: start.upperBound..<raw.endIndex) else { return raw }
            return "Attached: " + raw[start.upperBound..<end.lowerBound]
        }.joined(separator: "\n\n")
    }

    /// The user's visible text, for the "New chat" title rule.
    static func user(_ text: String) -> ChatMessage {
        ChatMessage(role: .user, parts: [.text(.init(text: text, state: .done))])
    }

    /// What goes on the wire (`POST /agent/chat` and the transcript PUT):
    /// reasoning is never sent back, and Atlas-only bookkeeping parts
    /// (memory, transfer) stay local — same as the desktop's `toUiMessages`.
    var wireParts: [ChatPart] {
        parts.filter { part in
            switch part {
            case .reasoning: return false
            case .other(let v):
                let t = v["type"]?.stringValue ?? ""
                return !["memory-ingest", "memory-provenance", "transfer-download"].contains(t)
            default: return true
            }
        }
    }

    var forWire: ChatMessage {
        var copy = self
        copy.parts = wireParts
        return copy
    }

    /// Tools left mid-flight by a dropped connection cannot be sent back as
    /// history (`tool_use` without `tool_result` is rejected), so they are
    /// closed out as errors — the desktop's `finalizeIncompleteTools`.
    /// `approvalResponded` counts as mid-flight too: the user let the call
    /// through but its result never arrived, so the row would otherwise spin
    /// — and never show a time — for the rest of the conversation.
    mutating func finalizeIncompleteTools(errorText: String = "Interrupted before the tool finished.") {
        for i in parts.indices {
            if case .tool(var t) = parts[i],
               t.state == .inputStreaming || t.state == .inputAvailable || t.state == .approvalResponded {
                t.state = .outputError
                t.errorText = errorText
                t.completedAt = Date.now.timeIntervalSince1970 * 1000
                parts[i] = .tool(t)
            }
        }
    }

    /// A new user message implicitly denies whatever was still waiting for
    /// approval — `supersedePendingApprovals`.
    mutating func supersedePendingApprovals() {
        for i in parts.indices {
            if case .tool(var t) = parts[i], t.state == .approvalRequested {
                t.state = .approvalResponded
                t.approval?.approved = false
                parts[i] = .tool(t)
            }
        }
    }

    var hasRenderableContent: Bool {
        parts.contains { part in
            switch part {
            case .text(let p): return !p.text.isEmpty
            case .reasoning(let p): return !p.text.isEmpty
            case .tool: return true
            default: return false
            }
        }
    }
}

/// One part of a message. Cases mirror AI SDK part types; unknown types
/// are kept verbatim in `.other` so a transcript never loses data.
enum ChatPart: Equatable, Sendable {
    case text(TextPart)
    case reasoning(ReasoningPart)
    case tool(ToolPart)
    case stepStart
    case data(DataPart)
    case file(FilePart)
    case sourceURL(SourceURLPart)
    /// The server's note on a turn that died (cancel, timeout, runtime
    /// error); persisted in the transcript and streamed to attached clients.
    case turnInterrupted(TurnInterruptedPart)
    case other(JSONValue)

    enum StreamState: String, Codable, Sendable { case streaming, done }

    struct TextPart: Equatable, Sendable {
        var id: String?
        var text: String
        var state: StreamState?
        var providerMetadata: JSONValue?
    }

    struct ReasoningPart: Equatable, Sendable {
        var id: String?
        var text: String
        var state: StreamState?
        var providerMetadata: JSONValue?
        /// When streaming started/ended — for the "Thought for 12s" label.
        var startedAt: Date?
        var endedAt: Date?
    }

    struct ToolPart: Equatable, Sendable, Identifiable {
        var id: String { toolCallId }
        enum State: String, Codable, Sendable {
            case inputStreaming = "input-streaming"
            case inputAvailable = "input-available"
            case approvalRequested = "approval-requested"
            case approvalResponded = "approval-responded"
            case outputAvailable = "output-available"
            case outputError = "output-error"
            case outputDenied = "output-denied"
        }

        struct Approval: Equatable, Sendable {
            var id: String
            /// HMAC from the backend; must be echoed back untouched.
            var signature: String?
            var approved: Bool?
            var reason: String?
            var source: String?
        }

        var toolCallId: String
        var toolName: String
        /// `dynamic-tool` parts encode as `{type:"dynamic-tool", toolName}`;
        /// static ones as `{type:"tool-<name>"}`.
        var isDynamic: Bool
        var state: State
        var input: JSONValue?
        /// Raw streamed input text before it parses as JSON.
        var inputText: String = ""
        var output: JSONValue?
        var errorText: String?
        var providerExecuted: Bool?
        var approval: Approval?
        var callProviderMetadata: JSONValue?
        var title: String?
        /// Atlas `authorization-decision` frame for this call (allow /
        /// require_auth, reason, triggeredBy…). Stored, never interpreted
        /// by the backend.
        var authorization: JSONValue?
        /// Client-side timing, milliseconds since epoch like the desktop.
        var startedAt: Double?
        var completedAt: Double?

        /// `input.label` first — every Atlas tool carries one — then the
        /// usual fallbacks. `toolName` last: on the Claude Code runtime it is
        /// a display title that can be the command itself.
        var displayLabel: String {
            if let t = title, !t.isEmpty { return t }
            for key in ["label", "title", "description", "name", "query", "url", "path", "filePath", "file_path", "pattern", "command"] {
                if let v = input?[key]?.stringValue, !v.isEmpty { return v }
            }
            return toolName
        }

        /// What the call actually is, inferred from the input shape — the
        /// Claude Code runtime's `toolName` is a title, not a tool.
        enum Kind: String {
            case terminal, read, write, edit, search, fetch, todos, question, task, plan, skill, memory, chart, generic
        }

        var kind: Kind {
            let lower = toolName.lowercased()
            if ["plan_create", "database_change_propose"].contains(lower) { return .plan }
            if lower == "save_memory" || lower == "memory_get" { return .memory }
            if lower == "render_chart" { return .chart }
            if lower.hasPrefix("load skill") || lower == "skill" { return .skill }
            guard let input else { return lower == "terminal" ? .terminal : .generic }
            if input["command"]?.stringValue != nil { return .terminal }
            if input["file_path"]?.stringValue != nil {
                if input["content"] != nil { return .write }
                if input["old_string"] != nil || input["new_string"] != nil { return .edit }
                return .read
            }
            if input["pattern"]?.stringValue != nil { return .search }
            if input["url"]?.stringValue != nil { return .fetch }
            if input["todos"]?.arrayValue != nil { return .todos }
            if input["questions"]?.arrayValue != nil || lower == "request_user_decision" { return .question }
            if input["plan"]?.stringValue != nil { return .plan }
            if input["prompt"]?.stringValue != nil, input["description"]?.stringValue != nil { return .task }
            if input["query"]?.stringValue != nil { return .search }
            return .generic
        }

        var kindLabel: String {
            switch kind {
            case .terminal: "Terminal"
            case .read: "Read file"
            case .write: "Write file"
            case .edit: "Edit file"
            case .search: "Search"
            case .fetch: "Fetch"
            case .todos: "To-dos"
            case .question: "Question"
            case .task: "Subtask"
            case .plan: "Plan"
            case .skill: "Skill"
            case .memory: "Memory"
            case .chart: "Chart"
            case .generic: toolName.count > 40 ? "Tool" : toolName
            }
        }

        var systemImage: String {
            switch kind {
            case .terminal: "terminal"
            case .read: "doc.text"
            case .write: "doc.badge.plus"
            case .edit: "pencil.line"
            case .search: "magnifyingglass"
            case .fetch: "globe"
            case .todos: "checklist"
            case .question: "questionmark.circle"
            case .task: "person.2"
            case .plan: "list.clipboard"
            case .skill: "sparkles"
            case .memory: "brain"
            case .chart: "chart.xyaxis.line"
            case .generic: "wrench.and.screwdriver"
            }
        }

        /// Shell-style tools (`bash`, `local_exec`, the Claude Code runtime's
        /// `Terminal`) — anything carrying a `command` string.
        var isCommandTool: Bool { input?["command"]?.stringValue != nil }
        var command: String? { input?["command"]?.stringValue }

        var isFinished: Bool {
            switch state {
            case .outputAvailable, .outputError, .outputDenied: true
            default: false
            }
        }
    }

    struct DataPart: Equatable, Sendable {
        /// The `data-<name>` suffix.
        var name: String
        var id: String?
        var data: JSONValue
        var type: String { "data-\(name)" }
    }

    struct FilePart: Equatable, Sendable {
        var mediaType: String
        var filename: String?
        var url: String
    }

    struct SourceURLPart: Equatable, Sendable {
        var sourceId: String
        var url: String
        var title: String?
    }

    struct TurnInterruptedPart: Equatable, Sendable {
        enum Reason: String, Sendable { case cancelled, timeout, error }
        var id: String
        var reason: Reason
        var message: String
        var createdAt: String

        init(id: String, reason: String?, message: String, createdAt: String) {
            self.id = id
            self.reason = Reason(rawValue: reason ?? "") ?? .error
            self.message = message
            self.createdAt = createdAt
        }

        init?(json: JSONValue) {
            guard json["type"]?.stringValue == "turn-interrupted",
                  let id = json["id"]?.stringValue,
                  let message = json["message"]?.stringValue else { return nil }
            self.init(id: id, reason: json["reason"]?.stringValue, message: message,
                      createdAt: json["createdAt"]?.stringValue ?? ISO8601DateFormatter().string(from: .now))
        }
    }
}

// MARK: - Codable (AI SDK JSON shape)

extension ChatMessage: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, role, parts, createdAt, metadata, turnOrigin, stoppedByUser, feedback
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        role = try c.decodeIfPresent(Role.self, forKey: .role) ?? .assistant
        parts = try c.decodeIfPresent([ChatPart].self, forKey: .parts) ?? []
        createdAt = try? c.decodeIfPresent(Date.self, forKey: .createdAt)
        metadata = try c.decodeIfPresent(JSONValue.self, forKey: .metadata)
        turnOrigin = try c.decodeIfPresent(String.self, forKey: .turnOrigin)
        stoppedByUser = try c.decodeIfPresent(Bool.self, forKey: .stoppedByUser)
        feedback = try c.decodeIfPresent(String.self, forKey: .feedback)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(role, forKey: .role)
        try c.encode(parts, forKey: .parts)
        try c.encodeIfPresent(createdAt, forKey: .createdAt)
        try c.encodeIfPresent(metadata, forKey: .metadata)
        try c.encodeIfPresent(turnOrigin, forKey: .turnOrigin)
        try c.encodeIfPresent(stoppedByUser, forKey: .stoppedByUser)
        try c.encodeIfPresent(feedback, forKey: .feedback)
    }
}

extension ChatPart: Codable {
    init(from decoder: Decoder) throws {
        let raw = try JSONValue(from: decoder)
        self = ChatPart(json: raw)
    }

    func encode(to encoder: Encoder) throws {
        try json.encode(to: encoder)
    }

    /// Builds a part from its JSON; anything unrecognised is kept as-is.
    init(json: JSONValue) {
        guard let type = json["type"]?.stringValue else { self = .other(json); return }
        switch type {
        case "text":
            self = .text(.init(
                id: json["id"]?.stringValue,
                text: json["text"]?.stringValue ?? "",
                state: json["state"]?.stringValue.flatMap(StreamState.init),
                providerMetadata: json["providerMetadata"]
            ))
        case "reasoning":
            self = .reasoning(.init(
                id: json["id"]?.stringValue,
                text: json["text"]?.stringValue ?? "",
                state: json["state"]?.stringValue.flatMap(StreamState.init),
                providerMetadata: json["providerMetadata"],
                startedAt: json["startedAt"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) },
                endedAt: json["completedAt"]?.numberValue.map { Date(timeIntervalSince1970: $0 / 1000) }
            ))
        case "turn-interrupted":
            if let part = TurnInterruptedPart(json: json) { self = .turnInterrupted(part) } else { self = .other(json) }
        case "step-start":
            self = .stepStart
        case "file", "image":
            self = .file(.init(
                mediaType: json["mediaType"]?.stringValue ?? "",
                filename: json["filename"]?.stringValue ?? json["fileName"]?.stringValue,
                url: json["url"]?.stringValue ?? ""
            ))
        case "source-url":
            self = .sourceURL(.init(
                sourceId: json["sourceId"]?.stringValue ?? "",
                url: json["url"]?.stringValue ?? "",
                title: json["title"]?.stringValue
            ))
        case "dynamic-tool":
            self = .tool(Self.toolPart(json: json, name: json["toolName"]?.stringValue ?? "tool", dynamic: true))
        case "tool":
            // The backend's persisted form: `{type:"tool", toolName, …}`.
            self = .tool(Self.toolPart(json: json, name: json["toolName"]?.stringValue ?? "tool", dynamic: false))
        default:
            if type.hasPrefix("tool-") {
                self = .tool(Self.toolPart(json: json, name: String(type.dropFirst(5)), dynamic: false))
            } else if type.hasPrefix("data-") {
                self = .data(.init(name: String(type.dropFirst(5)), id: json["id"]?.stringValue, data: json["data"] ?? .null))
            } else {
                self = .other(json)
            }
        }
    }

    private static func toolPart(json: JSONValue, name: String, dynamic: Bool) -> ToolPart {
        var approval: ToolPart.Approval?
        if let a = json["approval"], let id = a["id"]?.stringValue {
            approval = .init(
                id: id, signature: a["signature"]?.stringValue, approved: a["approved"]?.boolValue,
                reason: a["reason"]?.stringValue, source: a["source"]?.stringValue
            )
        }
        var state = json["state"]?.stringValue.flatMap(ToolPart.State.init) ?? .inputAvailable
        if json["state"] == nil, json["output"] != nil { state = .outputAvailable }
        return ToolPart(
            toolCallId: json["toolCallId"]?.stringValue ?? "",
            toolName: name,
            isDynamic: dynamic,
            state: state,
            input: json["input"],
            output: json["output"],
            errorText: json["errorText"]?.stringValue,
            providerExecuted: json["providerExecuted"]?.boolValue,
            approval: approval,
            callProviderMetadata: json["callProviderMetadata"],
            title: json["title"]?.stringValue,
            authorization: json["authorization"],
            startedAt: json["startedAt"]?.numberValue,
            completedAt: json["completedAt"]?.numberValue
        )
    }

    var json: JSONValue {
        switch self {
        case .text(let p):
            var o: [String: JSONValue] = ["type": .string("text"), "text": .string(p.text)]
            if let s = p.state { o["state"] = .string(s.rawValue) }
            if let m = p.providerMetadata { o["providerMetadata"] = m }
            return .object(o)
        case .reasoning(let p):
            var o: [String: JSONValue] = ["type": .string("reasoning"), "text": .string(p.text)]
            if let s = p.state { o["state"] = .string(s.rawValue) }
            if let m = p.providerMetadata { o["providerMetadata"] = m }
            if let d = p.startedAt { o["startedAt"] = .number(d.timeIntervalSince1970 * 1000) }
            if let d = p.endedAt { o["completedAt"] = .number(d.timeIntervalSince1970 * 1000) }
            return .object(o)
        case .turnInterrupted(let p):
            return .object([
                "type": .string("turn-interrupted"), "id": .string(p.id), "reason": .string(p.reason.rawValue),
                "message": .string(p.message), "createdAt": .string(p.createdAt),
            ])
        case .stepStart:
            return .object(["type": .string("step-start")])
        case .file(let p):
            var o: [String: JSONValue] = ["type": .string("file"), "mediaType": .string(p.mediaType), "url": .string(p.url)]
            if let f = p.filename { o["filename"] = .string(f) }
            return .object(o)
        case .sourceURL(let p):
            var o: [String: JSONValue] = ["type": .string("source-url"), "sourceId": .string(p.sourceId), "url": .string(p.url)]
            if let t = p.title { o["title"] = .string(t) }
            return .object(o)
        case .data(let p):
            var o: [String: JSONValue] = ["type": .string(p.type), "data": p.data]
            if let id = p.id { o["id"] = .string(id) }
            return .object(o)
        case .tool(let p):
            var o: [String: JSONValue] = [
                "type": .string(p.isDynamic ? "dynamic-tool" : "tool-\(p.toolName)"),
                "toolCallId": .string(p.toolCallId),
                "state": .string(p.state.rawValue),
            ]
            if p.isDynamic { o["toolName"] = .string(p.toolName) }
            if let v = p.input { o["input"] = v }
            if let v = p.output { o["output"] = v }
            if let v = p.errorText { o["errorText"] = .string(v) }
            if let v = p.providerExecuted { o["providerExecuted"] = .bool(v) }
            if let v = p.callProviderMetadata { o["callProviderMetadata"] = v }
            if let v = p.title { o["title"] = .string(v) }
            if let a = p.approval {
                var ao: [String: JSONValue] = ["id": .string(a.id)]
                if let v = a.signature { ao["signature"] = .string(v) }
                if let b = a.approved { ao["approved"] = .bool(b) }
                if let r = a.reason { ao["reason"] = .string(r) }
                if let v = a.source { ao["source"] = .string(v) }
                o["approval"] = .object(ao)
            }
            if let v = p.authorization { o["authorization"] = v }
            if let v = p.startedAt { o["startedAt"] = .number(v) }
            if let v = p.completedAt { o["completedAt"] = .number(v) }
            return .object(o)
        case .other(let v):
            return v
        }
    }
}
