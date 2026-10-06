import Foundation

enum ChatRowTests {
    static func run() {
        rendersUploadedFilesWithoutTransportInstructions()
        preservesHistoricalImages()
        preservesVerifiedSender()
        decodesSharedConversationPermissions()
        groupsThinkingButNotNarration()
        streamsCodexThinkingIntoOneRun()
        foldsFinishedWorkUnderOneHeader()
        rendersReasoningMarkdown()
        keepsNarrationBetweenToolCalls()
        followsTheNewestRun()
        closesOutToolsThatNeverReportedBack()
        foldsTurnsThatWereCutShort()
        placesTimelineEventsBetweenMessages()
        print("Chat row grouping, reasoning text, run following and tool timing passed")
    }

    private static func rendersUploadedFilesWithoutTransportInstructions() {
        let instruction = #"[The user uploaded 1 file(s) to the Nuphos file-transfer store (transfer group abc): report.pdf. To work with them, load the file-transfer skill and pull them into the sandbox: bash skills/file-transfer/scripts/transfer-pull.sh "$TEAM" abc ./uploads]"#
        var message = ChatMessage.user("Summarize this.")
        message.parts.append(.text(.init(text: instruction)))
        precondition(message.displayText == "Summarize this.\n\nAttached: report.pdf")
        precondition(message.forWire.text.contains("transfer-pull.sh"))
        precondition(ChatMessage.user("Ordinary user text").displayText == "Ordinary user text")
    }

    private static func preservesHistoricalImages() {
        let url = "data:image/jpeg;base64,/9j/2Q=="
        for type in ["file", "image"] {
            for nameKey in ["filename", "fileName"] {
                let raw: [String: Any] = ["id": "photo", "role": "user", "parts": [
                    ["type": type, "mediaType": "image/jpeg", nameKey: "photo.jpg", "url": url]
                ]]
                let data = try! JSONSerialization.data(withJSONObject: raw)
                let stored = try! JSONDecoder().decode(ChatMessage.self, from: data)
                let expected = ChatPart.file(.init(mediaType: "image/jpeg", filename: "photo.jpg", url: url))
                precondition(stored.parts == [expected], "Both persisted image formats must render as images")
                var stream = UIStreamReducer(message: ChatMessage(role: .assistant, parts: []))
                let event = try! JSONDecoder().decode(JSONValue.self, from: JSONSerialization.data(withJSONObject: (raw["parts"] as! [[String: Any]])[0]))
                _ = stream.apply(event)
                precondition(stream.message.parts == [expected], "Streaming images use the same format compatibility")
                let optimistic = ChatMessage(id: "photo", role: .user, parts: [expected])
                let finished = RuntimeTranscript.reconcile(server: stored, local: optimistic)
                precondition(finished.parts == [expected], "Finishing a stream must not lose or duplicate images")
                var reopened: [ChatMessage] = []
                var base = 0
                RuntimeTranscript.adopt(snapshot: [stored], firstIndex: 0, messages: &reopened, baseIndex: &base)
                precondition(reopened.first?.parts == [expected], "Reopened history must retain images without local state")
                let wire = try! JSONSerialization.jsonObject(with: JSONEncoder().encode(stored.forWire)) as! [String: Any]
                let part = (wire["parts"] as! [[String: Any]])[0]
                precondition(part["type"] as? String == "file" && part["filename"] as? String == "photo.jpg")
            }
        }
    }

    private static func preservesVerifiedSender() {
        var canonical = ChatMessage.user("Hello")
        canonical.metadata = .object(["version": .number(1), "sender": .object([
            "type": .string("user"), "id": .string("teammate"), "displayName": .string("Teammate"),
            "avatarURL": .string("https://lh3.googleusercontent.com/profile")
        ])])
        precondition(canonical.sender?.name == "Teammate" && canonical.sender?.avatar != nil)
        var local = canonical
        local.metadata = .object(["version": .number(1), "sender": .object(["displayName": .string("Unverified")])])
        var messages = [local]
        RuntimeTranscript.userTurn([canonical], messages: &messages)
        precondition(messages.count == 1 && messages[0].metadata == canonical.metadata)
        for bad in ["https://evil.example/avatar", "http://lh3.googleusercontent.com/avatar", "https://lh3.googleusercontent.com.evil.example/avatar", "https://user@lh3.googleusercontent.com/avatar", "https://lh3.googleusercontent.com:444/avatar"] {
            canonical.metadata = .object(["version": .number(1), "sender": .object(["displayName": .string("Teammate"), "avatarURL": .string(bad)])])
            precondition(canonical.sender?.avatar == nil)
        }
        canonical.metadata = nil
        precondition(canonical.sender == nil)
    }

    private static func decodesSharedConversationPermissions() {
        let decoder = JSONDecoder()
        let member = try! decoder.decode(AgentConversationDetail.self, from: Data(#"{"messages":[],"isOwner":false,"readOnly":false,"canCancelRun":true,"canRespondToRun":true}"#.utf8))
        precondition(member.isOwner == false && member.readOnly == false && member.canCancelRun == true && member.canRespondToRun == true)
        let shared = try! decoder.decode(AgentConversation.self, from: Data(#"{"sessionId":"shared","isOwner":false,"readOnly":false}"#.utf8))
        precondition(!shared.canManage)
        let owner = try! decoder.decode(AgentConversation.self, from: Data(#"{"sessionId":"owned","isOwner":true,"readOnly":false}"#.utf8))
        precondition(owner.canManage)
        let missing = try! decoder.decode(AgentConversationDetail.self, from: Data(#"{"messages":[]}"#.utf8))
        precondition(missing.isOwner == nil && missing.canCancelRun == nil && missing.canRespondToRun == nil)
    }

    private static func tool(_ id: String, state: ChatPart.ToolPart.State = .outputAvailable) -> ChatPart {
        var part = ChatPart.ToolPart(toolCallId: id, toolName: "bash", isDynamic: false, state: state)
        part.input = .object(["command": .string("ls")])
        return .tool(part)
    }

    private static func thought(_ text: String) -> ChatPart { .reasoning(.init(text: text, state: .done)) }
    private static func text(_ text: String, streaming: Bool = false) -> ChatPart {
        .text(.init(text: text, state: streaming ? .streaming : .done))
    }

    private static func interrupted(_ reason: ChatPart.TurnInterruptedPart.Reason, _ message: String) -> ChatPart {
        .turnInterrupted(.init(id: "int", reason: reason.rawValue, message: message, createdAt: "2026-01-01T00:00:00.000Z"))
    }

    private static func shape(_ rows: [ChatRow]) -> [String] {
        rows.map { row in
            switch row {
            case .assistantText(_, _, let text, _): "text:\(text)"
            case .reasoning: "thinking"
            case .toolRun(_, _, let items, _):
                "run:" + items.map { $0.tool.map { "tool.\($0.toolCallId)" } ?? "thinking" }.joined(separator: ",")
            case .work(_, let inner, _): "work[" + shape(inner).joined(separator: " ") + "]"
            case .hint(_, let text, _): "hint:\(text)"
            default: "other"
            }
        }
    }

    private static func groupsThinkingButNotNarration() {
        let message = ChatMessage(id: "m", role: .assistant, parts: [
            text("Running plan #522."),
            tool("a"), thought("**Reading for new output**"), tool("b"),
            thought("**Will create monitoring script**"),
            text("DNS replicas are ready."),
            thought("**Fetching session JSON**"),
            tool("c"), .stepStart, thought("**Preparing timer checker**"), tool("d", state: .inputAvailable),
            text("兩", streaming: true),
        ])
        let rows = ChatRow.assistantRows(message, live: true, lastApprovalCallId: nil)
        precondition(shape(rows) == [
            "text:Running plan #522.",
            "run:tool.a,thinking,tool.b",
            "thinking",
            "text:DNS replicas are ready.",
            "thinking",
            "run:tool.c,thinking,tool.d",
            "text:兩",
        ], "\(shape(rows))")
        precondition(Set(rows.map(\.id)).count == rows.count)
    }

    private static func streamsCodexThinkingIntoOneRun() {
        var reducer = UIStreamReducer(message: ChatMessage(id: "m", role: .assistant, parts: []))
        let frames = [
            #"{"type":"tool-input-available","toolCallId":"a","toolName":"bash","input":{"command":"ls"}}"#,
            #"{"type":"tool-output-available","toolCallId":"a","output":"ok"}"#,
            #"{"type":"reasoning-delta","delta":"**Inspect**"}"#,
            #"{"type":"reasoning-delta","delta":" the result"}"#,
            #"{"type":"tool-input-available","toolCallId":"b","toolName":"bash","input":{"command":"ls"}}"#,
            #"{"type":"tool-output-available","toolCallId":"b","output":"ok"}"#,
            #"{"type":"reasoning-delta","delta":"**Verify**"}"#,
            #"{"type":"tool-input-available","toolCallId":"c","toolName":"bash","input":{"command":"ls"}}"#,
        ]
        for frame in frames { _ = reducer.apply(JSONValue.parse(frame)!) }
        let rows = ChatRow.assistantRows(reducer.message, live: true, lastApprovalCallId: nil)
        precondition(shape(rows) == ["run:tool.a,thinking,tool.b,thinking,tool.c"], "\(shape(rows))")
        guard case .toolRun(_, _, _, let live) = rows[0] else { preconditionFailure() }
        precondition(live)
    }

    /// Narration between two tool calls is its own row, not swallowed into
    /// the run around it — what the transcript looked like it was doing when
    /// the answers between tool rows came out blank.
    private static func keepsNarrationBetweenToolCalls() {
        let message = ChatMessage(id: "m", role: .assistant, parts: [
            tool("a"), text("Checking the signatures."), tool("b"), text("Renaming the helper."),
        ])
        let rows = ChatRow.assistantRows(message, live: true, lastApprovalCallId: nil)
        precondition(
            shape(rows) == ["run:tool.a", "text:Checking the signatures.", "run:tool.b", "text:Renaming the helper."],
            "narration between tool calls must stay at top level, got \(shape(rows))"
        )
    }

    private static func foldsFinishedWorkUnderOneHeader() {
        let message = ChatMessage(id: "m", role: .assistant, parts: [
            tool("a"), thought("check"), tool("b"),
            text("Halfway there."),
            tool("c"),
            text("Done."),
        ])
        let rows = ChatRow.assistantRows(message, live: false, lastApprovalCallId: nil)
        precondition(shape(rows) == [
            "work[run:tool.a,thinking,tool.b text:Halfway there. run:tool.c]",
            "text:Done.",
        ], "\(shape(rows))")
        guard case .work(_, let inner, _) = rows[0] else { preconditionFailure() }
        precondition(inner.reduce(0) { $0 + ChatRow.workSteps($1) } == 3)
    }

    private static func rendersReasoningMarkdown() {
        let summary = "**Reading for new output**\n\nI'll poll the **job** again."
        precondition(ReasoningText.headline(summary) == "Reading for new output")
        precondition(ReasoningText.headline("\n  \n## Plan `next` step\nbody") == "Plan next step")
        precondition(ReasoningText.headline("   ") == nil)
        let rendered = String(ReasoningText.attributed(summary).characters)
        precondition(rendered == "Reading for new output\n\nI'll poll the job again.", rendered)
    }

    /// Every ending gives a tool a `completedAt`, so its row stops spinning
    /// and shows a real time instead of counting up forever.
    private static func closesOutToolsThatNeverReportedBack() {
        var approved = ChatMessage(id: "m", role: .assistant, parts: [tool("a", state: .approvalResponded)])
        approved.finalizeIncompleteTools()
        guard case .tool(let settled) = approved.parts[0] else { preconditionFailure() }
        precondition(settled.state == .outputError, "\(settled.state)")
        precondition(settled.completedAt != nil)

        for ending in ["tool-output-denied", "tool-input-error"] {
            var reducer = UIStreamReducer(message: ChatMessage(id: "m", role: .assistant, parts: []))
            _ = reducer.apply(.object([
                "type": .string("tool-input-start"), "toolCallId": .string("a"),
                "toolName": .string("bash"), "emittedAt": .number(1_000),
            ]))
            _ = reducer.apply(.object([
                "type": .string(ending), "toolCallId": .string("a"), "emittedAt": .number(3_000),
            ]))
            guard case .tool(let part) = reducer.message.parts[0] else { preconditionFailure() }
            precondition(part.startedAt == 1_000, "\(ending)")
            precondition(part.completedAt == 3_000, "\(ending): \(String(describing: part.completedAt))")
        }
    }

    /// A turn that timed out, failed or was stopped folds its work like any
    /// other finished turn — the notice telling the user what happened is what
    /// stays out in the open.
    private static func foldsTurnsThatWereCutShort() {
        let timedOut = ChatMessage(id: "m", role: .assistant, parts: [
            text("Checking."), tool("a"), tool("b"), interrupted(.timeout, "The agent runtime did not respond in time."),
        ])
        let rows = ChatRow.assistantRows(timedOut, live: false, lastApprovalCallId: nil)
        precondition(
            shape(rows) == ["work[text:Checking. run:tool.a,tool.b]", "hint:The agent runtime did not respond in time."],
            "an interrupted turn must fold with the notice outside, got \(shape(rows))"
        )

        let live = ChatRow.assistantRows(timedOut, live: true, lastApprovalCallId: nil)
        precondition(
            shape(live) == ["text:Checking.", "run:tool.a,tool.b", "hint:The agent runtime did not respond in time."],
            "a live turn must stay expanded, got \(shape(live))"
        )

        let answered = ChatMessage(id: "m", role: .assistant, parts: [
            tool("a"), tool("b"), text("Here is what I got."), interrupted(.error, "Runtime failure."),
        ])
        precondition(
            shape(ChatRow.assistantRows(answered, live: false, lastApprovalCallId: nil))
                == ["work[run:tool.a,tool.b]", "text:Here is what I got.", "hint:Runtime failure."],
            "a final answer belongs outside the fold with the notice"
        )

        var stopped = ChatMessage(id: "m", role: .assistant, parts: [text("On it."), tool("a"), tool("b")])
        stopped.stoppedByUser = true
        precondition(
            shape(ChatRow.assistantRows(stopped, live: false, lastApprovalCallId: nil))
                == ["work[text:On it. run:tool.a,tool.b]"],
            "a stopped turn folds too, got \(shape(ChatRow.assistantRows(stopped, live: false, lastApprovalCallId: nil)))"
        )
    }

    private static func followsTheNewestRun() {
        precondition(RuntimeTranscript.runToFollow(active: "next", attached: "quiet", stopped: nil) == "next")
        precondition(RuntimeTranscript.runToFollow(active: "next", attached: nil, stopped: nil) == "next")
        precondition(RuntimeTranscript.runToFollow(active: "same", attached: "same", stopped: nil) == nil)
        precondition(RuntimeTranscript.runToFollow(active: nil, attached: "quiet", stopped: nil) == nil)
        precondition(RuntimeTranscript.runToFollow(active: "stopped", attached: nil, stopped: "stopped") == nil)
    }

    private static func placesTimelineEventsBetweenMessages() {
        let at = { (seconds: TimeInterval, text: String) in ChatRow.TimelineEvent(at: Date(timeIntervalSince1970: seconds), text: text) }
        let dates: [Date?] = [Date(timeIntervalSince1970: 1), Date(timeIntervalSince1970: 3), nil]
        let placed = ChatRow.placeTimeline([at(0.5, "early"), at(2, "mid"), at(9, "late")], messageDates: dates, hasEarlier: false)
        precondition(placed.before[0]?.map(\.text) == ["early"])
        precondition(placed.before[1]?.map(\.text) == ["mid"])
        precondition(placed.before[2]?.map(\.text) == ["late"], "A streaming message counts as the newest")
        precondition(placed.trailing.isEmpty)
        precondition(ChatRow.placeTimeline([at(9, "late")], messageDates: Array(dates.prefix(2)), hasEarlier: false).trailing.count == 1)
        precondition(ChatRow.placeTimeline([at(0.5, "early")], messageDates: dates, hasEarlier: true).before.isEmpty,
                     "An event older than the loaded page waits for earlier history")
    }
}
