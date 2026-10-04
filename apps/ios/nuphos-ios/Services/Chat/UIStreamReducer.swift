import Foundation

/// Folds AI SDK v6 UI-message-stream events into an assistant
/// `ChatMessage`, the way the SDK's `processUIMessageStream` does. Events
/// the SDK does not define are handed to `onUnknown` so the Atlas layer can
/// interpret them.
struct UIStreamReducer {
    enum Outcome: Equatable, Sendable {
        case none
        case finished
        case aborted(reason: String?)
        case error(String)
    }

    var message: ChatMessage
    /// Raw JSON per tool call while its input is still streaming.
    private var partialToolInput: [String: String] = [:]

    init(message: ChatMessage) {
        self.message = message
    }

    /// Applies one decoded event. Returns what, if anything, ended.
    mutating func apply(_ event: JSONValue, onUnknown: (String, JSONValue) -> Void = { _, _ in }) -> Outcome {
        guard let type = event["type"]?.stringValue else { return .none }
        // Producer time: a client that reattaches replays buffered frames in
        // a burst, so local receipt time would make every duration zero.
        let nowMs = event["emittedAt"]?.numberValue ?? Date.now.timeIntervalSince1970 * 1000
        let now = Date(timeIntervalSince1970: nowMs / 1000)

        switch type {
        case "start":
            if let id = event["messageId"]?.stringValue, !id.isEmpty { message.id = id }
            if let meta = event["messageMetadata"] { message.metadata = meta }
            return .none

        case "message-metadata":
            if let meta = event["messageMetadata"] { message.metadata = meta }
            return .none

        case "start-step":
            message.parts.append(.stepStart)
            return .none

        case "finish-step":
            return .none

        case "reset-step":
            if let last = message.parts.lastIndex(of: .stepStart) {
                message.parts.removeSubrange((last + 1)...)
            }
            return .none

        // MARK: Text
        case "text-start":
            closeOpenParts(except: .text)
            message.parts.append(.text(.init(id: event["id"]?.stringValue, text: "", state: .streaming, providerMetadata: event["providerMetadata"])))
            return .none
        case "text-delta":
            closeOpenParts(except: .text)
            let id = event["id"]?.stringValue
            let delta = event["delta"]?.stringValue ?? ""
            if let i = textIndex(id: id) , case .text(var p) = message.parts[i] {
                p.text += delta
                if let m = event["providerMetadata"] { p.providerMetadata = m }
                message.parts[i] = .text(p)
            } else {
                message.parts.append(.text(.init(id: id, text: delta, state: .streaming)))
            }
            return .none
        case "text-end":
            if let i = textIndex(id: event["id"]?.stringValue), case .text(var p) = message.parts[i] {
                p.state = .done
                if let m = event["providerMetadata"] { p.providerMetadata = m }
                message.parts[i] = .text(p)
            }
            return .none

        // MARK: Reasoning
        case "reasoning-start":
            closeOpenParts(except: .reasoning)
            message.parts.append(.reasoning(.init(id: event["id"]?.stringValue, text: "", state: .streaming, providerMetadata: event["providerMetadata"], startedAt: now)))
            return .none
        case "reasoning-delta":
            closeOpenParts(except: .reasoning)
            let id = event["id"]?.stringValue
            let delta = event["delta"]?.stringValue ?? ""
            if let i = reasoningIndex(id: id), case .reasoning(var p) = message.parts[i] {
                p.text += delta
                if let m = event["providerMetadata"] { p.providerMetadata = m }
                message.parts[i] = .reasoning(p)
            } else {
                message.parts.append(.reasoning(.init(id: id, text: delta, state: .streaming, startedAt: now)))
            }
            return .none
        case "reasoning-end":
            if let i = reasoningIndex(id: event["id"]?.stringValue), case .reasoning(var p) = message.parts[i] {
                p.state = .done
                p.endedAt = now
                if let m = event["providerMetadata"] { p.providerMetadata = m }
                message.parts[i] = .reasoning(p)
            }
            return .none

        // MARK: Tools
        case "tool-input-start":
            closeOpenParts(except: .tool)
            let callId = event["toolCallId"]?.stringValue ?? ""
            let name = event["toolName"]?.stringValue ?? "tool"
            let dynamic = event["dynamic"]?.boolValue ?? false
            updateTool(callId: callId) { part in
                part.toolName = name
                part.isDynamic = dynamic
                part.state = .inputStreaming
                part.startedAt = part.startedAt ?? nowMs
                part.providerExecuted = event["providerExecuted"]?.boolValue ?? part.providerExecuted
                part.title = event["title"]?.stringValue ?? part.title
            }
            partialToolInput[callId] = ""
            return .none
        case "tool-input-delta":
            let callId = event["toolCallId"]?.stringValue ?? ""
            let delta = event["inputTextDelta"]?.stringValue ?? ""
            partialToolInput[callId, default: ""] += delta
            let raw = partialToolInput[callId] ?? ""
            updateTool(callId: callId) { part in
                part.inputText = raw
                part.state = .inputStreaming
                if let parsed = JSONValue.parse(raw) { part.input = parsed }
            }
            return .none
        case "tool-input-available":
            let callId = event["toolCallId"]?.stringValue ?? ""
            if !hasTool(callId: callId) { closeOpenParts(except: .tool) }
            updateTool(callId: callId) { part in
                // The Claude Code runtime re-sends the call with the command
                // as its name; the first name is the real one.
                if let name = event["toolName"]?.stringValue, part.toolName == "tool" || part.toolName.isEmpty { part.toolName = name }
                if let d = event["dynamic"]?.boolValue { part.isDynamic = d }
                part.state = .inputAvailable
                part.input = event["input"]
                part.inputText = ""
                part.startedAt = part.startedAt ?? nowMs
                part.providerExecuted = event["providerExecuted"]?.boolValue ?? part.providerExecuted
                part.callProviderMetadata = event["providerMetadata"] ?? part.callProviderMetadata
                part.title = event["title"]?.stringValue ?? part.title
            }
            partialToolInput[callId] = nil
            return .none
        case "tool-input-error":
            let callId = event["toolCallId"]?.stringValue ?? ""
            updateTool(callId: callId) { part in
                if let name = event["toolName"]?.stringValue { part.toolName = name }
                part.state = .outputError
                part.input = event["input"] ?? part.input
                part.errorText = event["errorText"]?.stringValue
                part.completedAt = part.completedAt ?? nowMs
            }
            return .none
        case "tool-approval-request":
            let callId = event["toolCallId"]?.stringValue ?? ""
            updateTool(callId: callId) { part in
                part.state = .approvalRequested
                if let id = event["approvalId"]?.stringValue { part.approval = .init(id: id) }
            }
            return .none
        case "tool-output-available":
            let callId = event["toolCallId"]?.stringValue ?? ""
            updateTool(callId: callId) { part in
                part.state = .outputAvailable
                part.output = event["output"]
                part.completedAt = part.completedAt ?? nowMs
                part.providerExecuted = event["providerExecuted"]?.boolValue ?? part.providerExecuted
            }
            return .none
        case "tool-output-error":
            let callId = event["toolCallId"]?.stringValue ?? ""
            updateTool(callId: callId) { part in
                part.state = .outputError
                part.errorText = event["errorText"]?.stringValue
                part.completedAt = part.completedAt ?? nowMs
                part.providerExecuted = event["providerExecuted"]?.boolValue ?? part.providerExecuted
            }
            return .none
        case "tool-output-denied":
            let callId = event["toolCallId"]?.stringValue ?? ""
            updateTool(callId: callId) { part in
                part.state = .outputDenied
                part.completedAt = part.completedAt ?? nowMs
            }
            return .none

        // MARK: Files / sources
        case "file", "image":
            message.parts.append(ChatPart(json: event))
            return .none
        case "source-url":
            message.parts.append(.sourceURL(.init(sourceId: event["sourceId"]?.stringValue ?? "", url: event["url"]?.stringValue ?? "", title: event["title"]?.stringValue)))
            return .none
        case "source-document":
            message.parts.append(.other(event))
            return .none

        // MARK: Lifecycle
        case "error":
            return .error(event["errorText"]?.stringValue ?? "Unknown error")
        case "finish":
            if let meta = event["messageMetadata"] { message.metadata = meta }
            finishStreamingParts()
            return .finished
        case "abort":
            finishStreamingParts()
            return .aborted(reason: event["reason"]?.stringValue)

        default:
            if type.hasPrefix("data-") {
                let name = String(type.dropFirst(5))
                let id = event["id"]?.stringValue
                let data = event["data"] ?? .null
                if let id, let i = message.parts.firstIndex(where: { if case .data(let d) = $0 { return d.id == id }; return false }) {
                    message.parts[i] = .data(.init(name: name, id: id, data: data))
                } else if event["transient"]?.boolValue != true {
                    message.parts.append(.data(.init(name: name, id: id, data: data)))
                }
                onUnknown(type, event)
                return .none
            }
            onUnknown(type, event)
            return .none
        }
    }

    /// Marks every still-streaming text/reasoning part as done (used on
    /// finish/abort and when a connection drops).
    mutating func finishStreamingParts() {
        for i in message.parts.indices {
            switch message.parts[i] {
            case .text(var p) where p.state == .streaming:
                p.state = .done; message.parts[i] = .text(p)
            case .reasoning(var p) where p.state == .streaming:
                p.state = .done; p.endedAt = p.endedAt ?? .now; message.parts[i] = .reasoning(p)
            default: break
            }
        }
    }

    // MARK: - Open parts

    private enum Kind { case text, reasoning, tool }

    /// Runtimes that skip `text-end` / `reasoning-end` (the Claude Code
    /// runtime sends deltas only) still change kind between parts; when they
    /// do, whatever was open is finished so the next delta starts a new part
    /// in the right place instead of appending to an earlier one.
    private mutating func closeOpenParts(except kind: Kind) {
        for i in message.parts.indices {
            switch message.parts[i] {
            case .text(var p) where p.state == .streaming && kind != .text:
                p.state = .done
                message.parts[i] = .text(p)
            case .reasoning(var p) where p.state == .streaming && kind != .reasoning:
                p.state = .done
                p.endedAt = p.endedAt ?? .now
                message.parts[i] = .reasoning(p)
            default:
                break
            }
        }
    }

    private func hasTool(callId: String) -> Bool {
        message.parts.contains { if case .tool(let t) = $0 { return t.toolCallId == callId }; return false }
    }

    // MARK: - Lookup

    private func textIndex(id: String?) -> Int? {
        if let id {
            if let i = message.parts.lastIndex(where: { if case .text(let p) = $0 { return p.id == id }; return false }) { return i }
        }
        return message.parts.lastIndex(where: { if case .text(let p) = $0 { return p.state == .streaming }; return false })
    }

    private func reasoningIndex(id: String?) -> Int? {
        if let id {
            if let i = message.parts.lastIndex(where: { if case .reasoning(let p) = $0 { return p.id == id }; return false }) { return i }
        }
        return message.parts.lastIndex(where: { if case .reasoning(let p) = $0 { return p.state == .streaming }; return false })
    }

    private mutating func updateTool(callId: String, _ change: (inout ChatPart.ToolPart) -> Void) {
        if let i = message.parts.firstIndex(where: { if case .tool(let t) = $0 { return t.toolCallId == callId }; return false }),
           case .tool(var part) = message.parts[i] {
            change(&part)
            message.parts[i] = .tool(part)
        } else {
            var part = ChatPart.ToolPart(toolCallId: callId, toolName: "tool", isDynamic: false, state: .inputStreaming)
            change(&part)
            message.parts.append(.tool(part))
        }
    }
}
