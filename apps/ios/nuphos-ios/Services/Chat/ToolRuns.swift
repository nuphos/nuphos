import Foundation

/// The desktop's `segmentParts`: plain tool calls and the thinking between
/// them form one run; narration and cards end it, so they stay where they
/// happened in the turn.
enum ToolRuns {
    enum Segment: Equatable {
        case part(Int)
        case run([Int])
    }

    /// Tools the desktop never renders as a row.
    static func isHidden(_ tool: ChatPart.ToolPart) -> Bool {
        tool.toolName == "skill" || tool.isQuestionCard
    }

    static func isPlainTool(_ tool: ChatPart.ToolPart) -> Bool {
        tool.kind != .plan && tool.kind != .question && tool.kind != .chart && tool.toolName != "render_artifact" && !isHidden(tool) && ThreadReference(tool) == nil
    }

    /// Parts that render as nothing; they neither join nor split a run.
    static func isInvisible(_ part: ChatPart) -> Bool {
        switch part {
        case .stepStart: true
        case .text(let text): text.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .reasoning(let reasoning): reasoning.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .tool(let tool): isHidden(tool)
        default: false
        }
    }

    static func segments(_ parts: [ChatPart]) -> [Segment] {
        var segments: [Segment] = []
        var run: [Int] = []
        func flush() {
            if !run.isEmpty { segments.append(.run(run)) }
            run = []
        }

        for (index, part) in parts.enumerated() {
            if isInvisible(part) {
                segments.append(.part(index))
                continue
            }
            if case .tool(let tool) = part, isPlainTool(tool) {
                run.append(index)
                continue
            }
            if case .reasoning = part, !run.isEmpty, plainToolFollows(parts, after: index) {
                run.append(index)
                continue
            }
            flush()
            segments.append(.part(index))
        }
        flush()
        return segments
    }

    private static func plainToolFollows(_ parts: [ChatPart], after index: Int) -> Bool {
        for part in parts[(index + 1)...] {
            if isInvisible(part) { continue }
            if case .reasoning = part { continue }
            if case .tool(let tool) = part { return isPlainTool(tool) }
            return false
        }
        return false
    }
}

/// What `render_artifact` and `render_chart` made, shown as a card in the chat as on the
/// desktop. Opening one fills the screen, the phone's side panel. A call that errored or
/// whose payload does not parse stays a tool row.
enum ToolCard: Equatable, Sendable, Identifiable {
    case artifact(id: String, title: String, kind: String, content: String)
    case chart(id: String, chart: Chart)

    struct Chart: Equatable, Sendable {
        var type: String
        var title: String
        var description: String?
        var xKey: String
        var series: [(key: String, label: String)]
        var rows: [[String: JSONValue]]

        static func == (a: Chart, b: Chart) -> Bool {
            a.type == b.type && a.title == b.title && a.description == b.description && a.xKey == b.xKey
                && a.series.map(\.key) == b.series.map(\.key) && a.series.map(\.label) == b.series.map(\.label) && a.rows == b.rows
        }
    }

    var id: String {
        switch self {
        case .artifact(let id, _, _, _), .chart(let id, _): id
        }
    }

    init?(_ part: ChatPart.ToolPart) {
        guard part.state != .outputError else { return nil }
        switch part.toolName {
        case "render_artifact":
            guard let input = part.input, let title = input["title"]?.stringValue,
                  let kind = input["kind"]?.stringValue, let content = input["content"]?.stringValue else { return nil }
            self = .artifact(id: part.toolCallId, title: title, kind: kind, content: content)
        case "render_chart":
            // The tool echoes its validated input, so a chart draws before its result lands.
            guard let payload = [part.output, part.input].compactMap({ $0 }).first(where: { $0["xKey"]?.stringValue != nil }),
                  let type = payload["type"]?.stringValue, let title = payload["title"]?.stringValue,
                  let xKey = payload["xKey"]?.stringValue else { return nil }
            let series = (payload["series"]?.arrayValue ?? []).compactMap { entry -> (key: String, label: String)? in
                guard let key = entry["key"]?.stringValue else { return nil }
                return (key, entry["label"]?.stringValue ?? key)
            }
            let rows = (payload["data"]?.arrayValue ?? []).compactMap(\.objectValue)
            guard !series.isEmpty, !rows.isEmpty else { return nil }
            self = .chart(id: part.toolCallId, chart: Chart(type: type, title: title, description: payload["description"]?.stringValue,
                                                            xKey: xKey, series: series, rows: rows))
        default:
            return nil
        }
    }
}
