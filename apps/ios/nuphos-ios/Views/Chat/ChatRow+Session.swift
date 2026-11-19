import Foundation

extension ChatRow {
    /// Closes a turn the user stopped, as the desktop does.
    static func stoppedText(_ message: ChatMessage) -> String {
        let calls = message.parts.filter { if case .tool(let t) = $0 { return !ToolRuns.hiddenTools.contains(t.toolName) }; return false }.count
        return calls == 0 ? String(localized: "Stopped by you") : calls == 1 ? String(localized: "Stopped by you · 1 call") : String(localized: "Stopped by you · \(calls) calls")
    }

    /// Builds rows for the whole transcript, with what its computer's state means for sending.
    static func rows(for session: ChatSession, presence: ComputerPresence = .online) -> [ChatRow] {
        var rows: [ChatRow] = []
        let messages = session.messages
        let lastApprovalCallId = session.canReply ? lastPendingApproval(in: messages) : nil
        let timeline = placeTimeline(session.timelineEvents, messageDates: messages.map(\.createdAt), hasEarlier: session.baseIndex > 0)
        let downloads = TransferDownloadGroup.anchor(session.downloads, in: messages)

        for (index, message) in messages.enumerated() {
            rows.append(contentsOf: (timeline.before[index] ?? []).map(timelineRow))
            let previous = messages[..<index].last(where: { !$0.isUnreadable })?.createdAt
            switch message.role {
            case .user:
                if message.event == nil, ChatTime.showsTimestamp(message.createdAt, after: previous), let date = message.createdAt {
                    rows.append(.timestamp(id: "time.\(message.id)", date: date))
                }
                if let answered = AnsweredQuestion.all(message, in: messages) {
                    // Its answer has not reached the agent yet: the last line says what it waits for.
                    let waiting = AnsweredQuestion.Notice(message.text.trimmingCharacters(in: .whitespacesAndNewlines))
                        .flatMap { session.waitingAnswers[$0.requestId] }
                    rows.append(contentsOf: answered.enumerated().map { index, question in
                        var question = question
                        if index == answered.count - 1 { question.waiting = waiting }
                        return .answered(id: "answered.\(message.id).\(index)", question: question)
                    })
                    continue
                }
                let me = session.sentHere.contains(message.id) ? session.me : nil
                if let row = userRow(message, id: "user.\(message.id)", messageId: message.id, fallback: me) { rows.append(row) }
            case .assistant:
                let isLive = session.isStreaming && index == messages.count - 1
                rows.append(contentsOf: assistantRows(message, live: isLive, lastApprovalCallId: lastApprovalCallId))
                rows.append(contentsOf: (downloads[message.id] ?? []).map { .downloads(id: "downloads.\($0.groupId)", groupId: $0.groupId) })
                let interrupted = message.parts.contains { if case .turnInterrupted = $0 { return true }; return false }
                if message.stoppedByUser == true, !isLive, !interrupted {
                    rows.append(.hint(id: "stopped.\(message.id)", text: stoppedText(message), isError: false))
                }
            case .system:
                continue
            }
        }
        rows.append(contentsOf: timeline.trailing.map(timelineRow))

        // The transcript already says why the last turn failed; the runtime
        // status and that turn's stream error would only repeat it below.
        let failure = shownFailure(in: messages)
        if session.sending != nil {
            rows.append(.sending)
        } else if session.failedSubmission != nil {
            rows.append(.failed)
        } else if session.isNativeRuntime {
            if let status = session.runtimeStatus, session.isStreaming || failure == nil {
                rows.append(.activity(text: status, live: session.isStreaming))
            }
        } else if session.isStreaming {
            rows.append(.activity(text: session.phaseLabel ?? String(localized: "Thinking…"), live: true))
        }
        if let error = session.error, !session.stoppedByUser, error != failure {
            rows.append(.hint(id: "error", text: error, isError: true))
        } else if session.error == nil, session.sending == nil, !session.isStreaming, session.serverQueued.isEmpty {
            // A queued send is already waking or waiting for its computer.
            switch presence {
            case .offline:
                // Said before the message goes, with the way on: another runtime.
                if let offline = AgentChatAPI.Conflict.runtimeOffline.errorDescription {
                    rows.append(.hint(id: "runtime-offline", text: offline, isError: true))
                }
            case .paused(let name):
                // Sending resumes a paused Box, so nothing points away from it.
                rows.append(.hint(id: "runtime-paused", text: String(localized: "\(name) is paused. It resumes when you send."), isError: false))
            case .online:
                break
            }
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
