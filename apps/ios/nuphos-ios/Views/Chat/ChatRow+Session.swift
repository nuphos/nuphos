import Foundation

extension ChatRow {
    /// Builds rows for the whole transcript.
    static func rows(for session: ChatSession) -> [ChatRow] {
        var rows: [ChatRow] = []
        let messages = session.messages
        let lastApprovalCallId = session.canReply ? lastPendingApproval(in: messages) : nil
        let timeline = placeTimeline(session.timelineEvents, messageDates: messages.map(\.createdAt), hasEarlier: session.baseIndex > 0)
        let downloads = TransferDownloadGroup.anchor(session.downloads, in: messages)

        for (index, message) in messages.enumerated() {
            rows.append(contentsOf: (timeline.before[index] ?? []).map(timelineRow))
            let previous = index > 0 ? messages[index - 1].createdAt : nil
            switch message.role {
            case .user:
                if ChatTime.showsTimestamp(message.createdAt, after: previous), let date = message.createdAt {
                    rows.append(.timestamp(id: "time.\(message.id)", date: date))
                }
                let text = message.displayText.trimmingCharacters(in: .whitespacesAndNewlines)
                let images = message.parts.compactMap { part -> String? in
                    if case .file(let f) = part, f.mediaType.hasPrefix("image/") { return f.url }
                    return nil
                }
                if !text.isEmpty || !images.isEmpty {
                    rows.append(.user(id: "user.\(message.id)", messageId: message.id, text: text, images: images, sender: message.sender ?? (session.sentHere.contains(message.id) ? session.me : nil)))
                }
            case .assistant:
                let isLive = session.isStreaming && index == messages.count - 1
                rows.append(contentsOf: assistantRows(message, live: isLive, lastApprovalCallId: lastApprovalCallId))
                rows.append(contentsOf: (downloads[message.id] ?? []).map { .downloads(id: "downloads.\($0.groupId)", group: $0) })
                let interrupted = message.parts.contains { if case .turnInterrupted = $0 { return true }; return false }
                if message.stoppedByUser == true, index == messages.count - 1, !session.isStreaming, !interrupted {
                    rows.append(.hint(id: "stopped.\(message.id)", text: "Stopped.", isError: false))
                }
            case .system:
                continue
            }
        }
        rows.append(contentsOf: timeline.trailing.map(timelineRow))

        if session.submitting {
            rows.append(.activity(text: "Sending…"))
        } else if session.isNativeRuntime {
            if let status = session.runtimeStatus {
                if session.isStreaming {
                    rows.append(.activity(text: status))
                } else {
                    rows.append(.hint(id: "runtime-status", text: status, isError: false))
                }
            }
        } else if session.isStreaming {
            rows.append(.activity(text: session.phaseLabel ?? "Thinking…"))
        }
        if let error = session.error, !session.stoppedByUser {
            rows.append(.hint(id: "error", text: error, isError: true))
        }
        return rows
    }

    /// Only the newest pending approval gets buttons.
    private static func lastPendingApproval(in messages: [ChatMessage]) -> String? {
        for m in messages.reversed() where m.role == .assistant {
            for p in m.parts.reversed() {
                if case .tool(let t) = p, t.state == .approvalRequested { return t.toolCallId }
            }
        }
        return nil
    }
}
