import Foundation

@main
struct RuntimeObservationTests {
    static func main() throws {
        try BotAvatarTests.run()
        LiveActivityCardTests.run()
        ResumeFallbackTests.run()
        func snapshot(_ json: String, at time: Double) -> RuntimeObservation {
            RuntimeObservation(snapshot: JSONValue.parse(json)!, observedAt: time)
        }
        let working = snapshot(#"{"schemaVersion":2,"epoch":"a","revision":4,"state":"active","phase":"running_tools","label":"Running tools…","actions":{"send":false,"cancel":true,"steer":true,"reply":false}}"#, at: 100)
        precondition(working.executing && working.allows("steer"))
        precondition(!working.allows("send"))
        // A busy current runtime still takes a message into the session queue;
        // only one too old to report its state is not waited on.
        precondition(working.mayAcceptLater)
        precondition(snapshot(#"{"state":"disconnected"}"#, at: 100).mayAcceptLater)
        precondition(!snapshot(#"{"state":"active"}"#, at: 100).mayAcceptLater)
        // Time alone never turns a status into "Connection lost": returning
        // from the background showed that until the next read landed.
        precondition(working.status == "Running tools…")
        let old = snapshot(#"{"epoch":"a","revision":3,"state":"idle"}"#, at: 105)
        precondition(!working.accepts(old)) // A late HTTP reply cannot clear newer streaming work.
        let replay = snapshot(#"{"epoch":"a","revision":4,"state":"active"}"#, at: 90)
        precondition(!working.accepts(replay)) // Buffered frames cannot refresh stale connectivity.
        let retiredEpoch = snapshot(#"{"epoch":"old","revision":999,"state":"active"}"#, at: 90)
        precondition(!working.accepts(retiredEpoch))
        let restart = snapshot(#"{"schemaVersion":2,"epoch":"b","revision":1,"state":"idle","phase":"idle","actions":{"send":true}}"#, at: 105)
        precondition(working.accepts(restart) && restart.status == nil)
        let background = snapshot(#"{"schemaVersion":2,"state":"idle","phase":"background_tools","label":"Background tools are still running","actions":{"send":true,"steer":false}}"#, at: 100)
        precondition(background.backgroundRunning && !background.turnActive && !background.executing)
        precondition(ConversationIndicator(working, unread: true) == .turn)
        precondition(ConversationIndicator(background, unread: true) == .background) // Still running beats unread.
        precondition(ConversationIndicator(background, unread: false) == .background)
        precondition(ConversationIndicator(nil, unread: true) == .unread && ConversationIndicator(nil, unread: false) == .none)
        for phase in ["idle", "failed", "cancelled"] {
            let finished = snapshot(#"{"schemaVersion":2,"state":"idle","phase":"\#(phase)","actions":{"send":true}}"#, at: 100)
            precondition(!finished.backgroundRunning && ConversationIndicator(finished, unread: true) == .unread)
        }
        let disconnected = snapshot(#"{"state":"disconnected"}"#, at: 100)
        precondition(ConversationIndicator(disconnected, unread: false) == .none)
        // The list's warning icon follows what the server said, not how long
        // ago it said it.
        precondition(disconnected.unavailable)
        precondition(snapshot(#"{"state":"unsupported"}"#, at: 100).unavailable)
        precondition(snapshot(#"{"state":"idle"}"#, at: 100).unavailable) // No schemaVersion 2: cannot report.
        precondition(!working.unavailable)
        precondition(!background.unavailable)
        let paused = snapshot(#"{"schemaVersion":2,"state":"active","phase":"resume_disconnected","label":"Automatic continuation paused: output connection lost","actions":{"send":false}}"#, at: 100)
        precondition(paused.paused && !paused.turnActive && !paused.backgroundRunning)
        precondition(ConversationIndicator(paused, unread: false) == .none)
        precondition(!paused.unavailable) // A paused continuation still reports a status.
        let continuing = snapshot(#"{"schemaVersion":2,"state":"active","phase":"resume_pending","actions":{"send":false}}"#, at: 100)
        precondition(ConversationIndicator(continuing, unread: true) == .turn)
        precondition(background.allows("send") && !background.allows("steer"))
        let legacy = snapshot(#"{"state":"active","actions":{"steer":true}}"#, at: 100)
        precondition(!legacy.allows("steer"))
        let store = RuntimeObservations()
        store.receive(working.snapshot, team: "t", session: "s", observedAt: 100)
        store.receive(old.snapshot, team: "t", session: "s", observedAt: 105)
        precondition(store.value(team: "t", session: "s")?.revision == 4)
        precondition(store.value(team: "other", session: "s") == nil)
        let unread = ConversationUnread()
        unread.receive(team: "t", session: "legacy", activity: nil, read: nil, displayed: false)
        unread.receive(team: "t", session: "s", activity: 2, read: 1, displayed: false)
        precondition(unread.contains(team: "t", session: "s") && !unread.contains(team: "t", session: "legacy"))
        unread.receive(team: "t", session: "s", activity: 2, read: 2, displayed: false)
        precondition(!unread.contains(team: "t", session: "s")) // Read on another device.
        unread.receive(team: "t", session: "s", activity: 2, read: 1, displayed: false)
        precondition(!unread.contains(team: "t", session: "s")) // A stale reply cannot move the marker back.
        unread.receive(team: "t", session: "s", activity: 3, read: 2, displayed: false)
        precondition(unread.contains(team: "t", session: "s"))
        let reader = UUID()
        unread.setReading(true, reader: reader, team: "t", session: "s")
        precondition(!unread.contains(team: "t", session: "s"))
        precondition(unread.claimRead(team: "t", session: "s") == nil) // A list row is not a displayed turn.
        unread.receive(team: "t", session: "s", activity: 3, read: 2, displayed: true)
        precondition(unread.claimRead(team: "t", session: "s") == 3)
        precondition(unread.claimRead(team: "t", session: "s") == nil)
        unread.confirm(team: "t", session: "s", target: 3, nil)
        precondition(unread.claimRead(team: "t", session: "s") == 3) // A failed read is retried.
        unread.confirm(team: "t", session: "s", target: 3, .init(activity: 3, read: 3))
        precondition(unread.isReading(team: "t", session: "s") && !unread.isReading(team: "t", session: "other"))
        unread.setReading(false, reader: reader, team: "t", session: "s")
        precondition(!unread.isReading(team: "t", session: "s"))
        precondition(!unread.contains(team: "t", session: "s"))
        unread.receive(team: "t", session: "s", activity: 4, read: 3, displayed: true)
        precondition(unread.contains(team: "t", session: "s") && unread.claimRead(team: "t", session: "s") == nil)
        var messages = [ChatMessage.user("Start")]
        let index = RuntimeTranscript.autonomous("auto-one", messages: &messages)
        messages[index].parts.append(.text(.init(text: "Working", state: .streaming)))
        precondition(RuntimeTranscript.autonomous("auto-one", messages: &messages) == index)
        precondition(messages.count == 2 && messages[index].text == "Working")
        RuntimeTranscript.steering(id: "receipt", text: "Change direction", messages: &messages)
        RuntimeTranscript.steering(id: "receipt", text: "Change direction", messages: &messages)
        precondition(messages[index].parts.count == 2)
        var reducer = UIStreamReducer(message: messages[index])
        _ = reducer.apply(JSONValue.parse(#"{"type":"text-start","id":"after-steer"}"#)!)
        _ = reducer.apply(JSONValue.parse(#"{"type":"text-delta","id":"after-steer","delta":"Updated"}"#)!)
        messages[index] = reducer.message
        precondition(messages[index].parts.count == 3 && messages[index].text == "WorkingUpdated")
        let restored = try JSONDecoder().decode([ChatMessage].self, from: JSONEncoder().encode(messages))
        precondition(restored[index].parts[1] == messages[index].parts[1])
        precondition(restored[index].text == messages[index].text)
        messages = restored
        RuntimeTranscript.steering(id: "receipt", text: "Change direction", messages: &messages)
        precondition(messages[index].parts.count == 3)
        precondition(RuntimeTranscript.autonomous("auto-two", messages: &messages) == 2)
        RuntimeTranscript.steering(id: "receipt", text: "Change direction", messages: &messages)
        precondition(messages[2].parts.isEmpty) // Late receipt cannot migrate into the next turn.
        var server = messages[index]
        server.parts = [.text(.init(text: "WorkingUpdated", state: .done))]
        let merged = RuntimeTranscript.reconcile(server: server, local: messages[index])
        precondition(merged.parts.count == 3 && merged.text == "WorkingUpdated")
        server.parts = [.text(.init(text: "Working", state: .done))]
        precondition(RuntimeTranscript.reconcile(server: server, local: messages[index]).text == "WorkingUpdated")
        server.parts = []
        precondition(RuntimeTranscript.reconcile(server: server, local: messages[index]).text == "WorkingUpdated")
        server.parts = [.text(.init(text: "WorkingUpdated and finished", state: .done))]
        let advanced = RuntimeTranscript.reconcile(server: server, local: messages[index])
        precondition(advanced.text == "WorkingUpdated and finished" && advanced.parts.count == 2)
        let runningTool = ChatPart(json: JSONValue.parse(#"{"type":"tool-exec","toolCallId":"t","state":"input-available","input":{}}"#)!)
        let completedTool = ChatPart(json: JSONValue.parse(#"{"type":"tool-exec","toolCallId":"t","state":"output-available","output":"ok"}"#)!)
        var localToolMessage = messages[index]
        localToolMessage.parts.append(runningTool)
        server.parts = [.text(.init(text: localToolMessage.text, state: .done)), completedTool]
        let completed = RuntimeTranscript.reconcile(server: server, local: localToolMessage)
        precondition(!completed.parts.contains(runningTool) && completed.parts.filter { $0 == completedTool }.count == 1)
        let user = ChatMessage.user("Start this turn")
        var temporary = messages[index]
        temporary.id = "temporary-assistant"
        var canonical = server
        canonical.id = "canonical-assistant"
        let nextUser = ChatMessage.user("Another turn")
        let nextAssistant = ChatMessage(id: "next-assistant", role: .assistant, parts: [])
        let expanded = RuntimeTranscript.reconcile(
            server: [user, canonical, nextUser, nextAssistant], serverBase: 5,
            local: [user, temporary], localBase: 5
        )
        precondition(expanded.count == 4 && expanded[1].id == canonical.id)
        precondition(expanded[1].parts.contains(temporary.parts[1]))
        precondition(expanded[3].parts.isEmpty)
        let otherTurn = RuntimeTranscript.reconcile(server: [nextUser, canonical], serverBase: 5, local: [user, temporary], localBase: 5)
        precondition(!otherTurn[1].parts.contains(temporary.parts[1]))
        let planTurn = ChatMessage(id: "plan-turn", role: .assistant, parts: [.text(.init(text: "Plan #522 is ready", state: .done))])
        var approval = ChatMessage.user("Approved plan #522 — please proceed with plan #522.")
        approval.id = "approval"
        var sender = [user, planTurn, approval]
        RuntimeTranscript.userTurn([approval], messages: &sender)
        precondition(sender.map(\.id) == [user.id, "plan-turn", "approval"])
        var follower = [user, planTurn]
        RuntimeTranscript.userTurn([approval], messages: &follower)
        precondition(follower.map(\.id) == sender.map(\.id)) // The other device gains the message and the boundary.
        let partial = ChatMessage(id: "partial", role: .assistant, parts: [.text(.init(text: "I will", state: .streaming))])
        var lateJoiner = [user, planTurn, approval, partial]
        RuntimeTranscript.userTurn([approval], messages: &lateJoiner)
        precondition(lateJoiner.map(\.id) == sender.map(\.id)) // The replay rebuilds the stored partial answer.
        followingARunStartedElsewhereNeverEmptiesTheTranscript()
        print("Runtime observation, transcript replay, steering, turn start and unread regressions passed")
        ChatRowTests.run()
        MessagePreviewTests.run()
        ComposerActionTests.run()
        SessionLinkTests.run()
        AppLinkTests.run()
        SessionMentionTests.run()
        SidebarFavoritesTests.run()
        ConversationNestingTests.run()
        ComposerDraftsTests.run()
        CredentialScopeTests.run()
        StreamBacklogTests.run()
        SSEClientTests.run()
        StreamingMarkdownTests.run()
        LocalAgentTests.run()
        ImageAttachmentTests.run()
        PastedFileTests.run()
        SignInSessionsTests.run()
    }

    /// Another device starts a turn: this one moves to the new run, and the
    /// snapshot it moves with can arrive with nothing in it yet. Adopting it
    /// blindly blanks the screen until the replay refills it.
    static func followingARunStartedElsewhereNeverEmptiesTheTranscript() {
        var messages = [
            ChatMessage(id: "u1", role: .user, parts: [.text(.init(text: "deploy it", state: .done))]),
            ChatMessage(id: "a1", role: .assistant, parts: [.text(.init(text: "Done.", state: .done))]),
        ]
        var baseIndex = 0

        // The detail that comes with the new run has nothing to show yet.
        RuntimeTranscript.adopt(snapshot: [], firstIndex: nil, messages: &messages, baseIndex: &baseIndex)
        precondition(messages.count == 2, "an empty snapshot must not clear the transcript")

        // The replay then brings the remote turn in on top of what was there.
        let remote = ChatMessage(id: "u2", role: .user, parts: [.text(.init(text: "and roll back", state: .done))])
        RuntimeTranscript.userTurn([remote], messages: &messages)
        precondition(!messages.isEmpty, "the transcript is never empty between states")
        precondition(messages.map(\.id) == ["u1", "a1", "u2"], "got \(messages.map(\.id))")

        // A snapshot with content still replaces it, rebased.
        RuntimeTranscript.adopt(snapshot: [remote], firstIndex: 7, messages: &messages, baseIndex: &baseIndex)
        precondition(messages.map(\.id) == ["u2"] && baseIndex == 7)
    }
}
