import Foundation

/// A list row derived from the transcript. Row IDs are stable across
/// streaming updates (same message + part → same ID) so SwiftUI updates
/// rows in place instead of replacing them; the content is what changes.
enum ChatRow: Identifiable, Equatable {
    case timestamp(id: String, date: Date)
    case user(id: String, messageId: String, text: String, images: [String], sender: ChatMessage.Sender? = nil)
    case assistantText(id: String, messageId: String, text: String, streaming: Bool)
    case reasoning(id: String, part: ChatPart.ReasoningPart)
    case tool(id: String, messageId: String, part: ChatPart.ToolPart, canDecide: Bool)
    /// Consecutive tool calls and the thinking between them, shown as one
    /// activity line — the desktop's tool run.
    case toolRun(id: String, messageId: String, items: [ToolRunItem], live: Bool)
    /// Finished intermediate work folded under one header.
    case work(id: String, rows: [ChatRow], duration: TimeInterval?)
    case memory(id: String, created: Int, updated: Int)
    case memoryRecall(id: String, entries: [MemoryEntry], fetched: Int)
    /// Files in a transfer group: what the agent sent during that reply's
    /// turn, or what the user uploaded with their message.
    case transfer(id: String, groupId: String, fromUser: Bool)

    enum ToolRunItem: Equatable, Identifiable {
        case tool(ChatPart.ToolPart, canDecide: Bool)
        case thinking(id: String, part: ChatPart.ReasoningPart)

        var id: String {
            switch self {
            case .tool(let t, _): "tool.\(t.toolCallId)"
            case .thinking(let id, _): id
            }
        }

        var tool: ChatPart.ToolPart? { if case .tool(let t, _) = self { return t }; return nil }
    }

    struct MemoryEntry: Equatable, Identifiable {
        let id: String
        let label: String
        let scope: String
    }
    case activity(text: String)
    case hint(id: String, text: String, isError: Bool)

    var id: String {
        switch self {
        case .timestamp(let id, _), .user(let id, _, _, _, _), .assistantText(let id, _, _, _),
             .reasoning(let id, _), .tool(let id, _, _, _), .toolRun(let id, _, _, _), .work(let id, _, _),
             .memory(let id, _, _), .memoryRecall(let id, _, _), .transfer(let id, _, _), .hint(let id, _, _):
            return id
        case .activity: return "activity"
        }
    }
}

extension ChatRow {
    static func assistantRows(_ message: ChatMessage, live: Bool, lastApprovalCallId: String?) -> [ChatRow] {
        var body: [ChatRow] = []

        for segment in ToolRuns.segments(message.parts) {
            let pi: Int
            switch segment {
            case .run(let indices):
                body.append(toolRun(message, indices: indices, live: live, lastApprovalCallId: lastApprovalCallId))
                continue
            case .part(let index):
                pi = index
            }
            switch message.parts[pi] {
            case .text(let p):
                guard !p.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                body.append(.assistantText(id: "text.\(message.id).\(pi)", messageId: message.id, text: p.text, streaming: live && p.state == .streaming))
            case .reasoning(let p):
                guard !p.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                body.append(.reasoning(id: "reasoning.\(message.id).\(pi)", part: p))
            case .tool(let t):
                guard !ToolRuns.hiddenTools.contains(t.toolName) else { continue }
                body.append(.tool(id: "tool.\(message.id).\(t.toolCallId)", messageId: message.id, part: t, canDecide: t.toolCallId == lastApprovalCallId))
            case .other(let v) where v["type"]?.stringValue == "memory-provenance":
                let labels = v["labels"]?.objectValue ?? [:]
                func entries(_ key: String, scope: String) -> [MemoryEntry] {
                    (v[key]?.arrayValue ?? []).compactMap(\.stringValue).map { MemoryEntry(id: $0, label: labels[$0]?.stringValue ?? $0, scope: scope) }
                }
                var seen = Set<String>()
                let all = (entries("recalledPersonalIds", scope: "personal") + entries("recalledTeamIds", scope: "team")
                           + entries("fetchedPersonalIds", scope: "personal") + entries("fetchedTeamIds", scope: "team"))
                    .filter { seen.insert($0.id).inserted }
                let fetched = v["fetchedIds"]?.arrayValue?.count ?? 0
                if !all.isEmpty || fetched > 0 {
                    body.append(.memoryRecall(id: "recall.\(message.id).\(v["turnKey"]?.stringValue ?? String(pi))", entries: all, fetched: fetched))
                }
            case .data(let receipt) where receipt.name == "steering":
                if let id = receipt.data["id"]?.stringValue, let text = receipt.data["text"]?.stringValue {
                    body.append(.user(id: "steering.\(id)", messageId: message.id, text: text, images: []))
                }
            case .turnInterrupted(let p):
                body.append(.hint(id: "interrupted.\(message.id).\(p.id)", text: p.reason == .cancelled ? "Stopped." : p.message, isError: p.reason != .cancelled))
            case .other(let v) where v["type"]?.stringValue == "memory-ingest":
                body.append(.memory(
                    id: "memory.\(v["eventId"]?.stringValue ?? String(pi))",
                    created: Int(v["memoriesCreated"]?.numberValue ?? 0),
                    updated: Int(v["memoriesUpdated"]?.numberValue ?? 0)
                ))
            default:
                continue
            }
        }

        // Once the turn is over, fold the work (narration, thinking, tools)
        // that came before the final answer into one collapsible header.
        guard !body.contains(where: { if case .user = $0 { return true }; return false }), !live,
              let foldEnd = foldEnd(body, stopped: message.stoppedByUser == true) else {
            return body
        }
        func foldable(_ row: ChatRow) -> Bool {
            switch row {
            case .reasoning, .assistantText: return true
            case .tool(_, _, let t, _): return t.kind != .plan && t.kind != .question && t.state != .approvalRequested
            case .toolRun(_, _, let items, _): return !items.contains { $0.tool?.state == .approvalRequested }
            default: return false
            }
        }
        let intermediate = body[..<foldEnd].filter(foldable)
        guard intermediate.reduce(0, { $0 + workSteps($1) }) >= 2 else { return body }
        let hasPending = intermediate.contains { if case .tool(_, _, let t, _) = $0 { return t.state == .approvalRequested }; return false }
        guard !hasPending else { return body }

        var folded: [ChatRow] = []
        var group: [ChatRow] = []
        func flush() {
            guard let first = group.first else { return }
            folded.append(.work(id: "work.\(message.id).\(first.id)", rows: group, duration: workDuration(message)))
            group = []
        }
        for (i, row) in body.enumerated() {
            if i < foldEnd, foldable(row) { group.append(row); continue }
            flush()
            folded.append(row)
        }
        flush()
        return folded
    }

    /// Where the fold ends. A turn that finished folds up to its answer; a turn
    /// the runtime cut short folds up to the interruption notice, keeping any
    /// answer text that ran just before it out in the open alongside the notice.
    private static func foldEnd(_ body: [ChatRow], stopped: Bool) -> Int? {
        if let notice = body.lastIndex(where: { if case .hint = $0 { return true }; return false }) {
            var split = notice
            while split > 0, case .assistantText = body[split - 1] { split -= 1 }
            return split
        }
        if stopped { return body.count }

        return body.lastIndex(where: { if case .assistantText = $0 { return true }; return false })
    }

    /// How many steps a folded row stands for; narration is not a step.
    static func workSteps(_ row: ChatRow) -> Int {
        switch row {
        case .toolRun(_, _, let items, _): items.filter { $0.tool != nil }.count
        case .assistantText: 0
        default: 1
        }
    }

    private static func toolRun(_ message: ChatMessage, indices: [Int], live: Bool, lastApprovalCallId: String?) -> ChatRow {
        let items: [ToolRunItem] = indices.compactMap { pi in
            switch message.parts[pi] {
            case .tool(let t): .tool(t, canDecide: t.toolCallId == lastApprovalCallId)
            case .reasoning(let p): .thinking(id: "reasoning.\(message.id).\(pi)", part: p)
            default: nil
            }
        }
        let latest = items.last { $0.tool != nil }?.tool
        let first = items.first { $0.tool != nil }?.tool?.toolCallId ?? String(indices[0])
        return .toolRun(id: "run.\(message.id).\(first)", messageId: message.id, items: items, live: live && latest.map { !$0.isFinished } == true)
    }

    private static func workDuration(_ message: ChatMessage) -> TimeInterval? {
        var start: Double?
        var end: Double?
        for part in message.parts {
            if case .tool(let t) = part {
                if let s = t.startedAt { start = min(start ?? s, s) }
                if let c = t.completedAt { end = max(end ?? c, c) }
            }
        }
        guard let start, let end, end > start else { return nil }
        return (end - start) / 1000
    }
}

extension ChatRow {
    typealias TimelineEvent = AgentConversationDetail.TimelineEvent

    /// Where the session's timeline events sit among the loaded messages, as on
    /// the desktop: before the first message newer than the event, or after the
    /// last one. An event older than the first loaded message waits while
    /// earlier history is unloaded — it may belong further back.
    static func placeTimeline(
        _ events: [TimelineEvent], messageDates: [Date?], hasEarlier: Bool
    ) -> (before: [Int: [TimelineEvent]], trailing: [TimelineEvent]) {
        var before: [Int: [TimelineEvent]] = [:]
        var trailing: [TimelineEvent] = []
        for event in events {
            // A message without a time yet is still streaming: the newest.
            guard let index = messageDates.firstIndex(where: { ($0 ?? .distantFuture) > event.at }) else {
                trailing.append(event)
                continue
            }
            if index > 0 || !hasEarlier { before[index, default: []].append(event) }
        }
        return (before, trailing)
    }

    static func timelineRow(_ event: TimelineEvent) -> ChatRow {
        .hint(id: "event.\(event.at.timeIntervalSince1970).\(event.text)", text: event.text, isError: false)
    }
}
