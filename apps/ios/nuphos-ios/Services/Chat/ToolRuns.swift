import Foundation

/// The desktop's `segmentParts`: plain tool calls and the thinking between
/// them form one run; narration and cards end it, so they stay where they
/// happened in the turn.
enum ToolRuns {
    enum Segment: Equatable {
        case part(Int)
        case run([Int])
    }

    /// Tools the desktop never renders.
    static let hiddenTools: Set<String> = ["skill"]

    static func isPlainTool(_ tool: ChatPart.ToolPart) -> Bool {
        tool.kind != .plan && tool.kind != .question && tool.kind != .chart && !hiddenTools.contains(tool.toolName) && ThreadReference(tool) == nil
    }

    /// Parts that render as nothing; they neither join nor split a run.
    static func isInvisible(_ part: ChatPart) -> Bool {
        switch part {
        case .stepStart: true
        case .text(let text): text.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .reasoning(let reasoning): reasoning.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .tool(let tool): hiddenTools.contains(tool.toolName)
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
