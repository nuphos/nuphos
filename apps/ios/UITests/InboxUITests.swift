import XCTest

/// The Inbox lists the open questions of every conversation, badges their
/// count on the native tab, and answers one from its card. Uses a copy of the
/// offline chats fixture, rewritten while the app runs.
final class InboxUITests: XCTestCase {
    private let pending = "GET /agent/conversations?pendingDecision=true"
    private var live: URL!
    /// What the app sent, one JSON line per request with a body (`NUPHOS_PREVIEW_REQUESTS`).
    private var sent: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "inbox-live-\(UUID().uuidString).json")
        // Outside the repository: the app may still send something after the test removes it.
        sent = FileManager.default.temporaryDirectory.appending(path: "inbox-sent-\(UUID().uuidString).jsonl")
        responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["POST /agent/chat"] = ["status": 200, "body": [:], "headers": ["Content-Type": "text/event-stream"]]
        // An answer goes to the answer API; no message is sent.
        for (session, request) in [("agent-ops", "q-deploy"), ("agent-staging", "q-staging"),
                                   ("agent-ops", "q-rollout"), ("bot-release", "q-deploy"), ("bot-release", "q-notes"), ("bot-release", "q-blog")] {
            responses["POST /agent/conversations/\(session)/decisions/\(request)/answer"] = ["status": 200, "body": ["ok": true]]
        }
        // The asking conversations, opened by "From …" and "Other…".
        for (id, title) in [("agent-ops", "Release ops"), ("agent-staging", "Check the staging cluster")] {
            responses["GET /agent/conversations/\(id)"] = ["status": 200, "body": [
                "title": title, "messages": [], "timelineEvents": [], "isOwner": true, "readOnly": false]]
        }
        try listQuestions([deploy, notes, staging])
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: live)
        try? FileManager.default.removeItem(at: sent)
    }

    /// An answer given in the Inbox says so (#3548), so the chat can say "Answered in Inbox".
    func testAnInboxAnswerSaysItWasGivenInTheInbox() throws {
        app = launch(page: "agent")
        let inboxTab = app.tabBars.buttons["Inbox"].firstMatch
        XCTAssertTrue(inboxTab.waitForExistence(timeout: 10), "No Inbox tab")
        inboxTab.tap()
        openQuestion("Roll out 1.4 to production?")
        XCTAssertTrue(app.buttons["Ship it"].waitForExistence(timeout: 5), "The question did not open")
        let tapped = Date()
        app.buttons["Ship it"].tap()
        let body = try answerBody(session: "agent-ops", request: "q-deploy")
        // Sent at once: nothing waits for an Undo.
        XCTAssertLessThan(Date().timeIntervalSince(tapped), 2, "The Inbox's answer was not sent at once")
        XCTAssertEqual(body["choices"] as? [String], ["Ship it"])
        XCTAssertEqual(body["answeredIn"] as? String, "inbox", "The Inbox's answer does not say it was given in the Inbox")
    }

    /// An answer given on the card in a Bot's chat does not claim the Inbox.
    func testAChatCardAnswerDoesNotSayInbox() throws {
        let ask = (deploy["inputRequests"] as? [[String: Any]])?.first ?? [:]
        try openBotChat(listing: [InboxUITests.row("bot-release", "Release Lead", ask)])
        app.buttons["Ship it"].firstMatch.tap()
        let body = try answerBody(session: "bot-release", request: "q-deploy")
        XCTAssertEqual(body["choices"] as? [String], ["Ship it"])
        XCTAssertNil(body["answeredIn"], "An answer in the chat says it was given in the Inbox")
    }

    /// The body of the answer the app sent for a question, once it has gone.
    private func answerBody(session: String, request: String) throws -> [String: Any] {
        try sentBody("POST /agent/conversations/\(session)/decisions/\(request)/answer")
    }

    /// The body the app sent with `key`, once it has gone.
    private func sentBody(_ key: String) throws -> [String: Any] {
        var body: [String: Any]?
        let found = NSPredicate { _, _ in
            let lines = (try? String(contentsOf: self.sent, encoding: .utf8))?.split(separator: "\n") ?? []
            body = lines.lazy.compactMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
                .first { $0["request"] as? String == key }?["body"] as? [String: Any]
            return body != nil
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: found, object: nil)], timeout: 15),
                       .completed, "Nothing was sent to \(key)")
        return try XCTUnwrap(body)
    }

    /// The list groups the questions by who asked, one line each; a question opens on its own,
    /// an answer leaves the list and opens the next one.
    func testAnswersAQuestionFromTheInbox() throws {
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()

        let inboxTab = app.tabBars.buttons["Inbox"].firstMatch
        XCTAssertTrue(inboxTab.waitForExistence(timeout: 10), "No Inbox tab")
        // Native tab badges render visually but are not exposed as the button's
        // value on iOS 26. The populated Inbox and screenshots verify this flow.
        inboxTab.tap()

        // Grouped under who asked; still badged on the Inbox title.
        let row = listed("Roll out 1.4 to production?")
        XCTAssertTrue(row.waitForExistence(timeout: 5), "The question is not listed")
        // Wide, a tap opens it beside the list: VoiceOver must say it can be activated.
        if app.windows.firstMatch.horizontalSizeClass == .regular {
            XCTAssertEqual(row.elementType, .button, "A wide row is not announced as a button")
        }
        XCTAssertTrue(app.staticTexts["Release Lead"].exists, "No group for the Bot that asked")
        XCTAssertTrue(app.staticTexts["Check the staging cluster"].exists, "No group for the Task that asked")
        XCTAssertTrue(inboxTab.isSelected)
        XCTAssertFalse(app.buttons["Mark as done"].exists, "A to-do is still marked done")
        shot("2-list")

        row.tap()
        XCTAssertTrue(app.buttons["Ship it"].waitForExistence(timeout: 5), "The question did not open")
        XCTAssertTrue(app.buttons["inbox.source"].exists, "No link to who asked")
        XCTAssertFalse(app.buttons["Open conversation"].exists)
        XCTAssertTrue(app.buttons["Snooze"].exists, "No Snooze")
        XCTAssertTrue(app.buttons["Dismiss"].exists, "No Dismiss")
        XCTAssertFalse(app.buttons["Skip"].exists, "Skip is still offered")
        shot("3-question")

        // The answer leaves the list and opens the next question; there is nothing to undo.
        app.buttons["Ship it"].tap()
        XCTAssertTrue(app.buttons["Friendly"].waitForExistence(timeout: 5), "The next question did not open")
        XCTAssertFalse(app.buttons["Undo"].exists, "The answer still offers Undo")
        shot("4-answered")
        try listQuestions([notes, staging])

        // The source's name opens the conversation that asked.
        openQuestion("Which node pool should the staging cluster use?")
        XCTAssertTrue(app.staticTexts["Which node pool should the staging cluster use?"].waitForExistence(timeout: 5))
        app.buttons["inbox.source"].tap()
        XCTAssertTrue(app.navigationBars.staticTexts["Check the staging cluster"].waitForExistence(timeout: 10)
                      || app.staticTexts["Check the staging cluster"].waitForExistence(timeout: 1),
                      "The asking conversation did not open")
    }

    /// Snooze sets a question aside until one of its times: it leaves the list for the Snoozed section,
    /// which says when it comes back, and Unsnooze brings it back now. Dismiss asks for an optional
    /// reason for the agent, and is sent at once.
    func testSnoozesAndDismissesAQuestionInTheInbox() throws {
        responses["POST /agent/conversations/agent-ops/decisions/q-deploy/snooze"] = ["status": 200, "body": ["ok": true]]
        responses["POST /agent/conversations/bot-release/decisions/q-notes/resolve"] = ["status": 200, "body": ["ok": true]]
        app = launch(page: "inbox")
        openQuestion("Roll out 1.4 to production?")

        let snooze = app.buttons["Snooze"]
        let dismiss = app.buttons["Dismiss"]
        XCTAssertTrue(snooze.waitForExistence(timeout: 10), "No Snooze")
        XCTAssertTrue(dismiss.exists, "No Dismiss")
        XCTAssertFalse(app.buttons["Skip"].exists, "Skip is still offered")
        let wide = app.windows.firstMatch.horizontalSizeClass == .regular
        for button in [snooze, dismiss] {
            XCTAssertGreaterThanOrEqual(button.frame.height.rounded(), wide ? 40 : 44, "\(button.label) is too small to hit")
        }
        XCTAssertEqual(snooze.frame.minY, dismiss.frame.minY, accuracy: 1, "Snooze and Dismiss are not side by side")
        shot("snooze-1-question")

        snooze.tap()
        let hour = app.buttons["1 hour"]
        XCTAssertTrue(hour.waitForExistence(timeout: 5), "Snooze does not offer its times")
        XCTAssertTrue(app.buttons["Tomorrow, 9:00"].exists, "No tomorrow morning")
        shot("snooze-2-menu")

        // The server lists it snoozed from now on: out of the list, into the Snoozed section.
        var snoozed = deploy
        var request = (snoozed["inputRequests"] as? [[String: Any]])?.first ?? [:]
        request["snoozedUntil"] = ISO8601DateFormatter().string(from: .now.addingTimeInterval(3_600))
        snoozed["inputRequests"] = [request]
        try listQuestions([snoozed, notes, staging])
        hour.tap()
        XCTAssertTrue(app.buttons["Friendly"].waitForExistence(timeout: 5), "The next question did not open")

        // Dismiss asks for a reason, which may be left out.
        app.buttons["Dismiss"].tap()
        let reason = app.textFields["Reason (optional)"].firstMatch
        XCTAssertTrue(reason.waitForExistence(timeout: 5), "Dismiss does not ask for a reason")
        reason.tap()
        reason.typeText("The drafts are not ready yet")
        shot("snooze-3-dismiss-reason")
        let tapped = Date()
        app.buttons["Dismiss question"].tap()
        let body = try sentBody("POST /agent/conversations/bot-release/decisions/q-notes/resolve")
        XCTAssertLessThan(Date().timeIntervalSince(tapped), 2, "The dismissal was not sent at once")
        XCTAssertEqual(body["reason"] as? String, "The drafts are not ready yet")
        XCTAssertFalse(app.buttons["Undo"].exists, "The dismissal still offers Undo")
        var blog = notes
        blog["inputRequests"] = (notes["inputRequests"] as? [[String: Any]])?.filter { $0["id"] as? String == "q-blog" }
        try listQuestions([snoozed, blog, staging])

        // On iPhone the next question is open over the list: back to it.
        if !wide {
            XCTAssertTrue(app.staticTexts["Post the 1.4 release notes to the blog too?"].waitForExistence(timeout: 5),
                          "The next question did not open")
            app.navigationBars.buttons.firstMatch.tap()
        }
        let row = app.descendants(matching: .any).matching(identifier: "inbox.snoozed").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10) && row.isHittable, "No Snoozed section")
        XCTAssertTrue(app.staticTexts["Snoozed"].exists, "The Snoozed section has no heading")
        XCTAssertTrue(row.staticTexts["Roll out 1.4 to production?"].exists, "The snoozed row does not name its question")
        XCTAssertFalse(listed("Roll out 1.4 to production?").exists, "The snoozed question is still in the list")
        shot("snooze-4-snoozed-section")

        try listQuestions([deploy, blog, staging])
        app.buttons["Unsnooze"].firstMatch.tap()
        XCTAssertTrue(listed("Roll out 1.4 to production?").waitForExistence(timeout: 10), "Unsnooze did not bring it back")
        XCTAssertFalse(row.exists, "The question is still snoozed")
    }

    /// "Other…" opens a text box with its send button; the words are the answer. A question with
    /// no options has the box already. A plan keeps only Approve and Reject.
    /// A question from a Task a Bot dispatched is in the Bot's group, naming the Task, as on Desktop
    /// (#2774): Tasks does not list that Task, so a group of its own would point at nothing there.
    func testABotsTaskQuestionIsInTheBotsGroup() throws {
        var changelog = InboxUITests.row(
            "agent-changelog", "Write the changelog",
            ["id": "q-guide", "category": "preference", "question": "Link the migration guide?",
             "options": ["Yes", "No"], "askedAt": "2026-11-03T09:45:00Z", "status": "open"])
        changelog["parentSessionId"] = "bot-release"
        try listQuestions([deploy, notes, staging, changelog])
        app = launch(page: "inbox")

        let row = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ AND label BEGINSWITH %@", "inbox.row", "Link the migration guide?")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "The Task's question is not listed")
        shot("bot-task-group")
        XCTAssertEqual(row.label, "Link the migration guide? · Write the changelog", "The row does not name the Task that asked")
        XCTAssertFalse(app.staticTexts["Write the changelog"].exists, "The Bot's Task has a group of its own")
        let lead = app.staticTexts["Release Lead"].firstMatch
        XCTAssertTrue(lead.exists, "No group for the Bot")
        XCTAssertGreaterThan(row.frame.minY, lead.frame.minY, "The Task's question is not under its Bot")
        XCTAssertLessThan(row.frame.minY, app.staticTexts["Release ops"].firstMatch.frame.minY, "The Bot's group lost its order")
    }

    func testAnswersInWordsWithOther() throws {
        try listQuestions([deploy, staging, plan])
        app = launch(page: "agent")
        app.tabBars.buttons["Inbox"].firstMatch.tap()

        listed("Roll out 1.4 to production?").tap()
        XCTAssertTrue(app.buttons["Other…"].waitForExistence(timeout: 10), "No Other…")
        XCTAssertFalse(app.textFields["Your answer"].exists, "The text box shows before Other…")
        app.buttons["Other…"].tap()
        let words = app.textFields["Your answer"].firstMatch
        XCTAssertTrue(words.waitForExistence(timeout: 5), "Other… does not open a text box")
        words.typeText("Ship after the 18:00 freeze")
        shot("5-other")
        app.buttons["Send answer"].firstMatch.tap()
        try listQuestions([staging, plan])
        XCTAssertEqual(try answerBody(session: "agent-ops", request: "q-deploy")["text"] as? String, "Ship after the 18:00 freeze")

        // Words only: the box is there without Other….
        openQuestion("Which node pool should the staging cluster use?")
        XCTAssertTrue(app.textFields["Your answer"].waitForExistence(timeout: 5), "No text box without options")
        XCTAssertFalse(app.buttons["Other…"].exists)

        // A plan: Approve or Reject, nothing in words.
        openQuestion("Approve the plan \"Move staging to the new cluster\"?")
        XCTAssertTrue(app.buttons["Approve"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Other…"].exists, "A plan is answered in words")
    }

    /// In a Bot's chat too, "Other…" asks for the answer in the card, not in the chat's composer.
    func testOtherAnswersInWordsInABotChat() throws {
        let ask = { (row: [String: Any]) in (row["inputRequests"] as? [[String: Any]])?.first ?? [:] }
        var own = InboxUITests.row("bot-release", "Release Lead", ask(deploy))
        own["inputRequests"] = [ask(deploy), ask(plan)]
        try openBotChat(listing: [own])
        XCTAssertEqual(app.buttons.matching(identifier: "Other…").count, 1, "Other… on the plan, or missing")
        shot("7-bot-chat")

        app.buttons["Other…"].firstMatch.tap()
        XCTAssertTrue(app.textFields["Your answer"].waitForExistence(timeout: 5),
                      "Other… does not ask for the answer in the card")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Replying to")).firstMatch.exists,
                       "The chat's composer quotes the question")
        shot("8-bot-chat-other-typed")
    }

    /// A Bot's chat shows a question as the Inbox does: the question as the heading under who asked,
    /// the options, "Other…" and "Dismiss" one row of the same pill in reading order, and "Show more" each a full
    /// touch target. Dismiss withdraws it unanswered; a chat offers no Snooze.
    func testABotChatCardLeadsWithTheQuestionAndDismisses() throws {
        responses["POST /agent/conversations/agent-ops/decisions/q-deploy/resolve"] = ["status": 200, "body": ["ok": true]]
        // Asked by a Task under the Bot, with more to read than four lines.
        var task = deploy
        task["parentSessionId"] = "bot-release"
        var request = (task["inputRequests"] as? [[String: Any]])?.first ?? [:]
        request["body"] = (1...8).map { "Finding \($0): the canary held for thirty minutes." }.joined(separator: "\n\n")
        task["inputRequests"] = [request]
        try openBotChat(listing: [task])
        shot("13-bot-chat-card")

        let heading = app.staticTexts["Roll out 1.4 to production?"]
        for label in ["Approval needed", "Decision needed", "From Release ops"] {
            XCTAssertFalse(app.staticTexts[label].exists || app.buttons[label].exists, "The card still shows “\(label)”")
        }
        XCTAssertEqual(app.buttons["botQuestion.source"].label, "Release ops", "The source line does not name who asked")
        let options = ["Ship it", "Wait for QA"].map { app.buttons[$0].frame }
        // Pills in reading order, left to right and then down, each the same height (#3468).
        XCTAssertTrue(options[0].minY < options[1].minY - 1 || (abs(options[0].minY - options[1].minY) <= 1 && options[0].minX < options[1].minX),
                      "The first option is not first")
        XCTAssertEqual(options[0].height, options[1].height, accuracy: 1, "The options are not one style")

        // Touch targets: 44pt, and "Show more" spans the body. A chat offers no Skip and no Snooze.
        XCTAssertFalse(app.buttons["Skip"].exists || app.buttons["Snooze"].exists, "The card offers Skip or Snooze")
        for label in ["Other…", "Dismiss"] {
            XCTAssertGreaterThanOrEqual(app.buttons[label].frame.height.rounded(), 44, "\(label) is too small to hit")
        }
        // "Other…" and "Dismiss" are buttons after the options, the same pill (#3468).
        for label in ["Other…", "Dismiss"] {
            XCTAssertEqual(app.buttons[label].frame.height, options[0].height, accuracy: 1, "\(label) is not the options' pill")
        }
        let other = app.buttons["Other…"].frame
        XCTAssertTrue(other.minY > options[1].minY + 1 || (abs(other.minY - options[1].minY) <= 1 && other.minX > options[1].maxX),
                      "Other… does not follow the options")
        let more = app.buttons["botQuestion.more"]
        XCTAssertGreaterThanOrEqual(more.frame.height.rounded(), 44, "Show more is too small to hit")
        XCTAssertGreaterThanOrEqual(more.frame.width, app.descendants(matching: .any)["botQuestion.body"].frame.width - 1, "Show more is not full-width")
        XCTAssertEqual(more.label, "Show more")
        more.tap()
        XCTAssertEqual(more.label, "Show less")
        // Once the expansion settles, the row sits under the whole body, not on it.
        let body = app.descendants(matching: .any)["botQuestion.body"]
        let settled = NSPredicate { _, _ in body.frame.maxY <= more.frame.minY + 1 }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: settled, object: nil)], timeout: 5),
                       .completed, "Show less is drawn over the body")
        sleep(1)
        shot("14-bot-chat-card-expanded")

        app.buttons["Dismiss"].tap()
        XCTAssertTrue(heading.waitForNonExistence(timeout: 5), "Dismiss left the question in the chat")
    }

    /// A secret a Task under the Bot asks for is given in the Bot's chat, with the task's masked
    /// card: saved on the asking conversation, never sent to the task to be answered there.
    func testABotChatAsksForASecretWithTheSecureInputCard() throws {
        responses["POST /agent/conversations/agent-ops/secrets"] = ["status": 200, "body": ["path": "/tmp/nuphos-secret-a1/0/DEPLOY_TOKEN"]]
        responses["POST /agent/conversations/agent-ops/decisions/q-token/resolve"] = ["status": 200, "body": ["ok": true]]
        var task = InboxUITests.row("agent-ops", "Release ops", [
            "id": "q-token", "category": "credential", "question": "The rollout needs a deploy token.",
            "secretName": "DEPLOY_TOKEN", "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
        task["parentSessionId"] = "bot-release"
        try openBotChat(listing: [task], asking: "The rollout needs a deploy token.")

        let field = app.secureTextFields["Paste the value"]
        let masked = field.waitForExistence(timeout: 10)
        shot("15-bot-chat-secret")
        XCTAssertTrue(masked, "No masked input for the secret in the Bot's chat")
        XCTAssertFalse(app.buttons["Answer in the task"].exists, "The secret is still sent to the task to be answered")
        XCTAssertEqual(app.buttons["botQuestion.source"].label, "Release ops", "The source line does not name who asked")
        XCTAssertTrue(app.buttons["Dismiss"].exists)

        field.tap()
        field.typeText("fixture-value")
        XCTAssertEqual(field.value as? String, String(repeating: "•", count: 13), "The value is not masked")
        shot("16-bot-chat-secret-typed")
        app.buttons["Send securely"].tap()
        XCTAssertTrue(app.staticTexts["DEPLOY_TOKEN saved on the task's runtime."].waitForExistence(timeout: 10),
                      "The secret was not saved on the conversation that asked")
        XCTAssertFalse(app.buttons["Dismiss"].exists, "A saved secret can still be dismissed")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "fixture-value")).firstMatch.exists,
                       "The value shows in the chat")
        shot("17-bot-chat-secret-saved")
    }

    /// The Inbox asks for a secret with the same masked card, saved on the conversation that asked.
    func testTheInboxAsksForASecretWithTheSecureInputCard() throws {
        responses["POST /agent/conversations/agent-ops/secrets"] = ["status": 200, "body": ["path": "/tmp/nuphos-secret-a1/0/DEPLOY_TOKEN"]]
        responses["POST /agent/conversations/agent-ops/decisions/q-token/resolve"] = ["status": 200, "body": ["ok": true]]
        try listQuestions([InboxUITests.row("agent-ops", "Release ops", [
            "id": "q-token", "category": "credential", "question": "The rollout needs a deploy token.",
            "secretName": "DEPLOY_TOKEN", "askedAt": "2026-11-03T09:40:00Z", "status": "open"])])
        app = launch(page: "agent")
        app.buttons["Inbox"].firstMatch.tap()
        openQuestion("The rollout needs a deploy token.")

        XCTAssertTrue(app.buttons["inbox.source"].waitForExistence(timeout: 10), "The question did not open")
        let field = app.secureTextFields["Paste the value"]
        let masked = field.waitForExistence(timeout: 10)
        shot("18-inbox-secret")
        XCTAssertTrue(masked, "No masked input for the secret in the Inbox")
        XCTAssertFalse(app.staticTexts["Answer it in Release ops."].exists, "The secret is still sent to the task to be answered")

        field.tap()
        field.typeText("fixture-value")
        app.buttons["Send securely"].tap()
        XCTAssertTrue(app.staticTexts["DEPLOY_TOKEN saved on the task's runtime."].waitForExistence(timeout: 10),
                      "The secret was not saved on the conversation that asked")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "fixture-value")).firstMatch.exists,
                       "The value shows in the Inbox")
        shot("19-inbox-secret-saved")
    }

    /// A secret can be declined (#3474): Dismiss sits under its masked card as under any question,
    /// and the reason goes to the agent as a dismissal. No value is sent.
    func testDismissesASecretInTheInboxWithAReason() throws {
        responses["POST /agent/conversations/agent-ops/decisions/q-token/resolve"] = ["status": 200, "body": ["ok": true]]
        try listQuestions([InboxUITests.row("agent-ops", "Release ops", [
            "id": "q-token", "category": "credential", "question": "The rollout needs a deploy token.",
            "secretName": "DEPLOY_TOKEN", "askedAt": "2026-11-03T09:40:00Z", "status": "open"])])
        app = launch(page: "inbox")
        openQuestion("The rollout needs a deploy token.")

        XCTAssertTrue(app.secureTextFields["Paste the value"].waitForExistence(timeout: 10), "No masked input for the secret")
        let dismiss = app.buttons["Dismiss"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 5), "A secret cannot be dismissed")
        XCTAssertTrue(app.buttons["Snooze"].exists, "A secret cannot be snoozed")
        shot("20-inbox-secret-dismiss")

        dismiss.tap()
        let reason = app.textFields["Reason (optional)"].firstMatch
        XCTAssertTrue(reason.waitForExistence(timeout: 5), "Dismiss does not ask for a reason")
        reason.tap()
        reason.typeText("Use the token already in CI")
        shot("21-inbox-secret-dismiss-reason")
        app.buttons["Dismiss question"].tap()
        let body = try sentBody("POST /agent/conversations/agent-ops/decisions/q-token/resolve")
        XCTAssertEqual(body["reason"] as? String, "Use the token already in CI")
        try listQuestions([])
        XCTAssertFalse(app.staticTexts["DEPLOY_TOKEN saved on the task's runtime."].exists, "A value was sent")
        XCTAssertFalse(listed("The rollout needs a deploy token.").exists, "The dismissed secret is still listed")
    }

    /// In a Bot's chat, an integration question naming providers opens the same scoped credential picker
    /// as the Inbox, never "Answer in the task"; once saved, the chat still lists only the Bot's questions.
    func testABotChatIntegrationQuestionChoosesCredentialsOnItsCard() throws {
        responses["GET /agent/credential-options"] = ["status": 200, "body": [
            "awsRoles": [["roleId": "role-prod", "accountId": "111122223333", "accountAlias": "prod-account"]],
            "gcpServiceAccounts": [["serviceAccountId": "sa-release", "projectId": "release-builds",
                                    "serviceAccountEmail": "release@release-builds.iam.gserviceaccount.com"]]]]
        responses["PATCH /agent/conversations/agent-ops/credentials"] = ["status": 200, "body": [
            "credentialAccess": ["gcpServiceAccountIds": ["sa-release"]], "options": [:]]]
        let question = "Select a Google Cloud account so I can read the release bucket."
        var task = InboxUITests.row("agent-ops", "Release ops", [
            "id": "q-gcp", "category": "integration", "question": question,
            "providers": ["gcp"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
        task["parentSessionId"] = "bot-release"
        // Asked outside this Bot: never in its chat, before or after a save.
        try openBotChat(listing: [task, staging], asking: question)
        let choose = app.buttons["Choose credentials"]
        let offered = choose.waitForExistence(timeout: 10)
        shot("20-bot-chat-integration")
        XCTAssertTrue(offered, "The Bot chat's integration card does not offer its credentials")
        XCTAssertFalse(app.buttons["Answer in the task"].exists, "The question is still sent to the task to be answered")

        choose.tap()
        let account = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "release-builds")).firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10), "The picker does not list the Google Cloud account")
        XCTAssertFalse(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "prod-account")).firstMatch.exists,
                       "The picker lists a provider the question did not ask for")
        account.tap()
        shot("21-bot-chat-picker")
        // Done with the question still listed open: the card says why, and the other Bot's question stays out.
        app.buttons["Done"].firstMatch.tap()
        let failure = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "adds no credential")).firstMatch
        XCTAssertTrue(failure.waitForExistence(timeout: 10), "A save that leaves the question open says nothing")
        XCTAssertFalse(app.staticTexts["Which node pool should the staging cluster use?"].exists,
                       "A question outside this Bot joined its chat after the save")
        shot("22-bot-chat-still-open")
    }

    /// Opens the release chat as a Bot's 1:1, where the Bot's questions and those under it show.
    private func openBotChat(listing: [[String: Any]], asking question: String = "Roll out 1.4 to production?") throws {
        var detail = try XCTUnwrap(responses["GET /agent/conversations/chat-release"] as? [String: Any])
        var body = try XCTUnwrap(detail["body"] as? [String: Any])
        body["faces"] = [["id": "bot-release", "name": "Release Lead", "agent": ["avatar": "05"]]]
        detail["body"] = body
        responses["GET /agent/conversations/chat-release"] = detail
        try listQuestions(listing)
        app = launch()
        app.staticTexts["release-planning"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts[question].waitForExistence(timeout: 15), "The question is not in the Bot's chat")
    }

    /// An integration question is answered in the Inbox: its conversation's credential picker
    /// opens there, with the member's own GitHub to select, and nothing navigates away.
    func testAnIntegrationQuestionChoosesCredentialsInTheInbox() throws {
        responses["GET /agent/credential-options"] = ["status": 200, "body": [
            "personalCredentials": [["provider": "github", "login": "octocat"]]]]
        responses["PATCH /agent/conversations/agent-ops/credentials"] = ["status": 200, "body": [
            "credentialAccess": ["personalCredentialIds": ["github"]], "options": [:]]]
        var github = deploy
        github["inputRequests"] = [["id": "q-github", "category": "integration",
                                    "question": "Select your own GitHub so I can open the PR as you.",
                                    "providers": ["github"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"],
                                   // One naming the member's own GitHub: answered by that alone, with no picker.
                                   ["id": "q-own", "category": "integration",
                                    "question": "Connect your own GitHub so I can push as you.",
                                    "credentials": [["provider": "personal", "id": "github"]],
                                    "askedAt": "2026-11-03T09:41:00Z", "status": "open"]]
        try listQuestions([github])
        app = launch(page: "agent")
        app.tabBars.buttons["Inbox"].firstMatch.tap()
        openQuestion("Select your own GitHub so I can open the PR as you.")
        let choose = app.buttons["Choose credentials"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10), "The integration card does not offer its credentials")
        shot("9-inbox-integration")

        choose.tap()
        let own = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "octocat")).firstMatch
        XCTAssertTrue(own.waitForExistence(timeout: 10), "The picker does not list the member's own GitHub")
        own.tap()
        shot("10-inbox-integration-picker")
        app.buttons["Done"].firstMatch.tap()
        // Saved in place: the Inbox stays.
        XCTAssertTrue(app.staticTexts["Select your own GitHub so I can open the PR as you."].waitForExistence(timeout: 5))

        openQuestion("Connect your own GitHub so I can push as you.")
        XCTAssertTrue(app.buttons["Use your own GitHub"].waitForExistence(timeout: 5),
                      "The own-GitHub question does not offer the member's credential")
    }

    /// An integration question's picker lists only the providers it asks for. Done says why when the
    /// question is still open, and leaves once a credential it asks for is selected. Every other card is
    /// answered on itself: one naming no provider with its options or words, a sign-in status card with
    /// its options, and a words-only card under a markdown body with its question in view.
    func testAnIntegrationQuestionOffersItsProvidersAndOneNamingNoneTakesWords() throws {
        responses["GET /agent/credential-options"] = ["status": 200, "body": [
            "awsRoles": [["roleId": "role-prod", "accountId": "111122223333", "accountAlias": "prod-account"]],
            "gcpServiceAccounts": [["serviceAccountId": "sa-release", "projectId": "release-builds",
                                    "serviceAccountEmail": "release@release-builds.iam.gserviceaccount.com"]]]]
        responses["PATCH /agent/conversations/agent-ops/credentials"] = ["status": 200, "body": [
            "credentialAccess": ["gcpServiceAccountIds": ["sa-release"]], "options": [:]]]
        for id in ["q-play", "q-signin", "q-repo"] {
            responses["POST /agent/conversations/agent-ops/decisions/\(id)/answer"] = ["status": 200, "body": ["ok": true]]
        }
        let gcp: [String: Any] = ["id": "q-gcp", "category": "integration",
                                  "question": "Select a Google Cloud account so I can read the release bucket.",
                                  "providers": ["gcp"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"]
        let play: [String: Any] = ["id": "q-play", "category": "integration",
                                   "question": "How should I handle Android releases stuck in Play review?",
                                   "body": "I have no read access to the Play Console, so I can't see the review status.",
                                   "options": ["I'll check the Publishing overview", "Wait for it to go live"],
                                   "askedAt": "2026-11-03T09:41:00Z", "status": "open"]
        let signIn: [String: Any] = ["id": "q-signin", "category": "credential",
                                     "question": "Sign in to GitHub once on the Mac mini, then pick Signed in",
                                     "options": ["Signed in", "Not now"], "askedAt": "2026-11-03T09:42:00Z", "status": "open"]
        let repo: [String: Any] = ["id": "q-repo", "category": "preference",
                                   "question": "Which repo gets the windows-signing environment?",
                                   "body": "**Done**: the signer role is assigned to **ZeaburOSS**.\n\n**Missing**:\n1. The repo\n2. The six variable names",
                                   "askedAt": "2026-11-03T09:43:00Z", "status": "open"]
        var ops = deploy
        ops["inputRequests"] = [gcp, play, signIn, repo]
        try listQuestions([ops])
        app = launch(page: "agent")
        app.buttons["Inbox"].firstMatch.tap()
        openQuestion("Select a Google Cloud account so I can read the release bucket.")
        let choose = app.buttons["Choose credentials"]
        XCTAssertTrue(choose.waitForExistence(timeout: 10), "The integration card does not offer its credentials")
        shot("1-integration-card")

        // Only Google Cloud: the AWS role answers nothing here.
        choose.tap()
        let account = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "release-builds")).firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10), "The picker does not list the Google Cloud account")
        XCTAssertFalse(app.buttons.containing(NSPredicate(format: "label CONTAINS %@", "prod-account")).firstMatch.exists,
                       "The picker lists a provider the question did not ask for")
        shot("2-picker-scoped")
        // Done with nothing new selected: the card says why it is still open.
        app.buttons["Done"].firstMatch.tap()
        let failure = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "adds no credential")).firstMatch
        XCTAssertTrue(failure.waitForExistence(timeout: 10), "A save that leaves the question open says nothing")
        shot("3-still-open-says-why")

        // Selecting the account answers it: the server closes the question, and it leaves the Inbox.
        choose.tap()
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        ops["inputRequests"] = [play, signIn, repo]
        try listQuestions([ops])
        app.buttons["Done"].firstMatch.tap()
        XCTAssertTrue(listed("Select a Google Cloud account so I can read the release bucket.").waitForNonExistence(timeout: 10),
                      "The answered question is still listed")
        shot("4-answered-leaves")

        // No connector names Play Console: its options and words, never a picker that can't answer it.
        openQuestion("How should I handle Android releases stuck in Play review?")
        XCTAssertTrue(app.buttons["I'll check the Publishing overview"].waitForExistence(timeout: 5),
                      "A question naming no provider hides its options")
        XCTAssertFalse(app.buttons["Choose credentials"].exists, "A question naming no provider offers a picker that can't answer it")
        shot("5-no-provider-options")
        app.buttons["Other…"].firstMatch.tap()
        let field = app.textFields["Your answer"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5), "A question naming no provider can't be answered in words")
        field.typeText("Check the review status by hand and tell me")
        shot("6-no-provider-typed")
        ops["inputRequests"] = [signIn, repo]
        try listQuestions([ops])
        app.buttons["Send answer"].firstMatch.tap()
        XCTAssertTrue(listed("How should I handle Android releases stuck in Play review?").waitForNonExistence(timeout: 10),
                      "The answered question is still listed")

        // A sign-in status card: its options, never "Answer it in" the task.
        openQuestion("Sign in to GitHub once on the Mac mini, then pick Signed in")
        XCTAssertTrue(app.buttons["Signed in"].waitForExistence(timeout: 5), "A sign-in status card hides its options")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Answer it in")).firstMatch.exists,
                       "A card sends its answer elsewhere")
        shot("7-status-card-options")
        ops["inputRequests"] = [repo]
        try listQuestions([ops])
        app.buttons["Signed in"].firstMatch.tap()
        XCTAssertTrue(listed("Sign in to GitHub once on the Mac mini, then pick Signed in").waitForNonExistence(timeout: 10),
                      "The answered question is still listed")

        // Words only, under a markdown body: the question stays in view above its answers.
        openQuestion("Which repo gets the windows-signing environment?")
        let title = app.staticTexts["Which repo gets the windows-signing environment?"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 5) && title.isHittable, "The question is hidden")
        XCTAssertTrue(app.textFields["Your answer"].firstMatch.waitForExistence(timeout: 5), "A words-only question can't be answered")
        // The answers sit at the bottom, under the question, not over it.
        XCTAssertGreaterThan(app.buttons["Dismiss"].firstMatch.frame.minY, app.frame.height * 0.7, "The answers cover the question")
        shot("8-words-only-in-view")
    }

    /// #3468: a single- and a multi-select question are the same pills, "Other…", "Snooze" and "Dismiss"; a
    /// multi-select only picks any number of them, with a check, and sends them with Send.
    func testASingleAndAMultiSelectQuestionAreOneCard() throws {
        let single = InboxUITests.row(
            "agent-ops", "Release ops",
            ["id": "q-first", "category": "preference", "question": "Which region ships first?",
             "body": "The rollout starts after the freeze.", "options": ["us-east", "eu-west"],
             "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
        // Each from its own Task: the Inbox lists one question per source at a time.
        let multi = InboxUITests.row(
            "agent-rollout", "Rollout plan",
            ["id": "q-today", "category": "preference", "question": "Which regions ship today?",
             "body": "The rollout starts after the freeze.", "options": ["us-east", "eu-west", "ap-south"],
             "multiSelect": true, "askedAt": "2026-11-03T09:41:00Z", "status": "open"])
        try listQuestions([single, multi])
        app = launch(page: "agent")
        app.tabBars.buttons["Inbox"].firstMatch.tap()

        openQuestion("Which region ships first?")
        XCTAssertTrue(app.buttons["eu-west"].waitForExistence(timeout: 10), "No options")
        XCTAssertTrue(app.buttons["Other…"].exists && app.buttons["Snooze"].exists && app.buttons["Dismiss"].exists)
        XCTAssertFalse(app.buttons["Skip"].exists, "Skip is still offered")
        XCTAssertFalse(app.buttons["Send"].exists, "A single-select is answered by its option")
        shot("13-inbox-single-select")

        openQuestion("Which regions ship today?")
        XCTAssertTrue(app.buttons["us-east"].waitForExistence(timeout: 10), "No options")
        shot("14-inbox-multi-select")
        let send = app.buttons["Send"]
        XCTAssertTrue(send.waitForExistence(timeout: 10), "No Send for the picks")
        XCTAssertTrue(app.buttons["us-east"].exists && app.buttons["Other…"].exists && app.buttons["Dismiss"].exists,
                      "The multi-select is not the single-select's capsules")
        XCTAssertFalse(app.textFields["Your answer"].exists, "The text box shows before Other…")
        XCTAssertFalse(app.buttons["Send answer"].exists, "The multi-select is still a form")
        XCTAssertFalse(send.isEnabled, "Send before anything is picked")
        // Where a single-select's options are: pinned under the question on iPhone.
        if UIDevice.current.userInterfaceIdiom == .phone {
            XCTAssertGreaterThan(app.buttons["Dismiss"].firstMatch.frame.minY, app.frame.height * 0.7,
                                 "The multi-select options are not where a single-select's are")
        }
        app.buttons["us-east"].tap()
        app.buttons["ap-south"].tap()
        XCTAssertTrue(app.buttons["us-east"].isSelected && app.buttons["ap-south"].isSelected && !app.buttons["eu-west"].isSelected,
                      "A tap does not pick, or picks one only")
        XCTAssertTrue(send.isEnabled)
        // Once the picks have settled, so both checks draw alike.
        sleep(1)
        shot("15-inbox-multi-select-picked")
        // With "Other…" open, the keyboard up, Send stays above it.
        app.buttons["Other…"].tap()
        let words = app.textFields["Your answer"].firstMatch
        XCTAssertTrue(words.waitForExistence(timeout: 5), "Other… does not open a text box")
        XCTAssertTrue(send.isHittable && words.isHittable, "Send or the text box is hidden")
        // The pinned card on iPhone rides above the keyboard.
        if UIDevice.current.userInterfaceIdiom == .phone {
            XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "No keyboard")
            XCTAssertLessThan(send.frame.maxY, app.keyboards.firstMatch.frame.minY, "Send is under the keyboard")
        }
        shot("16-inbox-multi-select-other")
        app.buttons["Other…"].tap()
        send.tap()
        try listQuestions([single])
        XCTAssertTrue(listed("Which regions ship today?").waitForNonExistence(timeout: 5), "The answered question stayed")
    }

    /// A card asking several questions, one of them multi-select, picks the same capsules per
    /// question and sends them at once: options picked, or the answer typed with "Other…"/"Reply…".
    func testAnswersSeveralQuestionsInOneCard() throws {
        let rollout = InboxUITests.row(
            "agent-ops", "Release ops",
            ["id": "q-rollout", "category": "preference", "question": "How should the staging rollout go?",
             // As the backend sends it: the questions written out after the separator for older clients.
             "body": "The new build passed CI.\n\n---\n\n**1. Which regions should get it first?** (any number)\n- us-east\n- eu-west\n- ap-south\n\n**2. Keep the old cluster afterwards?**\n- Keep it for a week\n- Delete it\n\n**3. Anything the release note must mention?**",
             "questions": [
                ["question": "Which regions should get it first?", "options": ["us-east", "eu-west", "ap-south"],
                 "multiSelect": true],
                ["question": "Keep the old cluster afterwards?", "options": ["Keep it for a week", "Delete it"]],
                ["question": "Anything the release note must mention?"],
             ],
             "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
        try listQuestions([rollout])
        app = launch(page: "agent")
        app.tabBars.buttons["Inbox"].firstMatch.tap()
        XCTAssertTrue(listed("How should the staging rollout go?").waitForExistence(timeout: 10),
                      "The question is not listed")
        openQuestion("How should the staging rollout go?")
        shot("11-inbox-several-questions")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "(any number)")).firstMatch.exists,
                       "The list written out for older clients shows beside the form")

        // By label: the card's own identifier covers those inside it.
        let send = app.buttons["Send"]
        XCTAssertTrue(send.exists && !send.isEnabled, "Send before every question is answered")
        app.buttons["us-east"].tap()
        app.buttons["eu-west"].tap()
        app.buttons["Keep it for a week"].tap()
        app.buttons["Reply…"].tap()
        let note = app.textFields["Your answer"]
        XCTAssertTrue(note.waitForExistence(timeout: 5), "Reply… does not open a text box")
        note.typeText("Mention the new region picker.")
        XCTAssertTrue(send.isEnabled)
        shot("12-inbox-several-questions-filled")

        send.tap()
        try listQuestions([])
        XCTAssertTrue(listed("How should the staging rollout go?").waitForNonExistence(timeout: 5),
                      "The answered question stayed")
    }

    /// Its row in the list; wide, it may already be open beside it.
    private func openQuestion(_ question: String) {
        let back = app.navigationBars.buttons.firstMatch
        if !listed(question).waitForExistence(timeout: 2), back.exists { back.tap() }
        listed(question).tap()
    }

    /// Its row by its words, whatever it is to accessibility: wide, a row is a button.
    /// A question asked before the one-line limit is its card's one line, cut with an ellipsis,
    /// until a tap shows it in full.
    func testALongQuestionIsOneLineUntilTapped() throws {
        let question = "Delete the staging cluster now? It has been idle for thirty days, costs about forty dollars a day, and nobody has deployed to it since the migration."
        try listQuestions([InboxUITests.row(
            "agent-ops", "Release ops",
            ["id": "q-deploy", "category": "approval", "question": question, "body": "Idle since the migration.",
             "options": ["Delete", "Keep"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"])])
        app = launch(page: "agent")
        let inboxTab = app.tabBars.buttons["Inbox"].firstMatch
        XCTAssertTrue(inboxTab.waitForExistence(timeout: 10), "No Inbox tab")
        inboxTab.tap()
        let row = listed(question)
        XCTAssertTrue(row.waitForExistence(timeout: 10), "The question is not listed")
        shot("long-question-list")
        row.tap()

        let title = app.staticTexts["inbox.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5), "The question did not open")
        let line = title.frame.height
        XCTAssertLessThan(line, 40, "The question wraps over several lines")
        XCTAssertTrue(app.descendants(matching: .any)["inbox.body"].exists, "No body under the question")
        shot("long-question-cut")

        title.tap()
        let opened = expectation(for: NSPredicate { _, _ in title.frame.height > line * 2 }, evaluatedWith: nil)
        wait(for: [opened], timeout: 3)
        shot("long-question-open")
    }

    /// An option says what it says: one too long for a line wraps onto as many as it needs,
    /// growing its pill, rather than being cut with an ellipsis (#3599). A short one keeps
    /// the single line it always had.
    func testLongOptionsWrapInsteadOfBeingCut() throws {
        let long = ["接受手機版改成全寬可換行的選項列表，桌面版維持原本的膠囊排列先不要動",
                    "接受手機版的做法，並且把桌面版的選項也一起改成同樣的全寬排列",
                    "手機版改成可以換行的膠囊，單行的高度與間距都保持現在的樣子"]
        let short = "先擱置"
        try listQuestions([InboxUITests.row(
            "agent-ops", "Release ops",
            ["id": "q-deploy", "category": "preference", "question": "選項的版面要怎麼調整？",
             "options": long + [short], "askedAt": "2026-11-03T09:40:00Z", "status": "open"])])
        app = launch(page: "agent")
        let inboxTab = app.tabBars.buttons["Inbox"].firstMatch
        XCTAssertTrue(inboxTab.waitForExistence(timeout: 10), "No Inbox tab")
        inboxTab.tap()
        openQuestion("選項的版面要怎麼調整？")

        let line = app.buttons[short]
        XCTAssertTrue(line.waitForExistence(timeout: 10), "The question did not open")
        shot("long-options")
        for option in long {
            let button = app.buttons[option]
            XCTAssertTrue(button.exists, "The option is not on the card")
            XCTAssertEqual(button.label, option, "The option does not carry its whole text")
            // Cut to one line, an option is as tall as the short one; wrapped, it is taller.
            XCTAssertGreaterThan(button.frame.height, line.frame.height,
                                 "“\(option)” is still one line, so it is cut with an ellipsis")
        }
        // Grown, not drawn over each other.
        for (above, below) in zip(long, long.dropFirst()) {
            XCTAssertLessThanOrEqual(app.buttons[above].frame.maxY, app.buttons[below].frame.minY + 1,
                                     "“\(above)” overlaps the option under it")
        }
    }

    private func listed(_ question: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ AND label == %@", "inbox.row", question)).firstMatch
    }

    private func launch(page: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"] + (page.map { ["-page", $0] } ?? [])
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path, "NUPHOS_PREVIEW_REQUESTS": sent.path]
        app.launch()
        return app
    }

    // MARK: - Fixture

    private let deploy: [String: Any] = InboxUITests.row(
        "agent-ops", "Release ops",
        ["id": "q-deploy", "category": "approval", "question": "Roll out 1.4 to production?",
         "body": "CI passed on `main`. The release adds **two migrations**, both backwards compatible.\n\n- Canary: 5% for 30 minutes\n- Rollback: `acme rollout undo`",
         "options": ["Ship it", "Wait for QA"], "askedAt": "2026-11-03T09:40:00Z", "status": "open"])
    /// A Bot's two: its group wears the Bot's face, with a divider between its rows.
    private let notes: [String: Any] = {
        var row = InboxUITests.row(
            "bot-release", "Release Lead",
            ["id": "q-notes", "category": "preference", "question": "Which tone should the 1.4 release notes take?",
             "body": "Drafts for both are in the release doc.",
             "options": ["Friendly", "Formal"], "askedAt": "2026-11-03T09:30:00Z", "status": "open"])
        row["inputRequests"] = (row["inputRequests"] as? [[String: Any]] ?? []) + [
            ["id": "q-blog", "category": "preference", "question": "Post the 1.4 release notes to the blog too?",
             "options": ["Yes", "No"], "askedAt": "2026-11-03T09:35:00Z", "status": "open"]]
        row["avatar"] = "05"
        return row
    }()
    private let staging: [String: Any] = InboxUITests.row(
        "agent-staging", "Check the staging cluster",
        ["id": "q-staging", "category": "preference", "question": "Which node pool should the staging cluster use?",
         "options": [], "askedAt": "2026-11-03T09:10:00Z", "status": "open"])

    private let plan: [String: Any] = InboxUITests.row(
        "agent-migrate", "Migrate staging",
        ["id": "q-plan", "category": "approval", "question": "Approve the plan \"Move staging to the new cluster\"?",
         "options": ["Approve", "Reject"], "planId": "p1", "askedAt": "2026-11-03T09:20:00Z", "status": "open"])

    private static func row(_ id: String, _ title: String, _ request: [String: Any]) -> [String: Any] {
        ["sessionId": id, "teamId": "64b5f1c2e4b0a1d2c3e4f5a6", "title": title, "firstMessage": title,
         "messageCount": 4, "createdAt": "2026-11-03T08:00:00Z", "lastActiveAt": "2026-11-03T09:40:00Z",
         "isOwner": true, "readOnly": false, "agentRuntime": "claude-code", "inputRequests": [request]]
    }

    private func listQuestions(_ rows: [[String: Any]]) throws {
        responses[pending] = ["status": 200, "body": ["conversations": rows, "parents": [], "nextCursor": NSNull(), "hasMore": false]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
    }

    /// The simulator's screen only; also saved to `NUPHOS_SHOTS` when the run sets it.
    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(filePath: dir).appending(path: "\(name).png"))
        }
    }
}
