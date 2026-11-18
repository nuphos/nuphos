import XCTest

/// The Inbox lists the open questions of every conversation, badges their
/// count on the native tab, and answers one from its card. Uses a copy of the
/// offline chats fixture, rewritten while the app runs.
final class InboxUITests: XCTestCase {
    private let pending = "GET /agent/conversations?pendingDecision=true"
    private var live: URL!
    private var responses: [String: Any] = [:]
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        live = fixture.deletingLastPathComponent().appending(path: "inbox-live-\(UUID().uuidString).json")
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
    }

    /// The list groups the questions by who asked, one line each; a question opens on its own,
    /// an answer leaves the list with a toast and opens the next one.
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
        XCTAssertTrue(app.buttons["Skip"].exists)
        shot("3-question")

        // The answer leaves the list, says so, and opens the next question.
        app.buttons["Ship it"].tap()
        let toast = app.staticTexts["Answered “Ship it”"]
        XCTAssertTrue(toast.waitForExistence(timeout: 5), "No toast saying what was answered")
        XCTAssertTrue(app.buttons["Undo"].exists, "No Undo on the toast")
        XCTAssertTrue(app.buttons["Friendly"].waitForExistence(timeout: 5), "The next question did not open")
        shot("4-answered")

        // Undo takes it back before it is sent: the question is open again.
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.buttons["Ship it"].waitForExistence(timeout: 5), "Undo did not bring the question back")
        XCTAssertFalse(toast.exists)
        app.buttons["Ship it"].tap()
        // Sent after five seconds: the toast goes with it.
        XCTAssertTrue(toast.waitForNonExistence(timeout: 10), "The answer was never sent")
        try listQuestions([notes, staging])

        // Skip opens the one after it without answering: the next in the same group, then the next group.
        app.buttons["Skip"].tap()
        XCTAssertTrue(app.staticTexts["Post the 1.4 release notes to the blog too?"].waitForExistence(timeout: 5),
                      "Skip did not open the next question")
        app.buttons["Skip"].tap()
        XCTAssertTrue(app.staticTexts["Which node pool should the staging cluster use?"].waitForExistence(timeout: 5),
                      "Skip did not open the next group's question")

        // The source's name opens the conversation that asked.
        app.buttons["inbox.source"].tap()
        XCTAssertTrue(app.navigationBars.staticTexts["Check the staging cluster"].waitForExistence(timeout: 10)
                      || app.staticTexts["Check the staging cluster"].waitForExistence(timeout: 1),
                      "The asking conversation did not open")
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
        XCTAssertTrue(app.buttons["Undo"].waitForExistence(timeout: 5), "No toast for the answer")

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
    /// the first option first, "Other…", "Skip" and "Show more" each a full touch target. Skip
    /// withdraws it unanswered.
    func testABotChatCardLeadsWithTheQuestionAndSkips() throws {
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
        let wide = app.windows.firstMatch.horizontalSizeClass == .regular
        XCTAssertTrue(wide ? options[0].minX < options[1].minX : options[0].minY < options[1].minY, "The first option is not first")

        // Touch targets: 44pt on iPhone; wide, 40pt capsules. "Show more" spans the card.
        for label in ["Other…", "Skip"] {
            XCTAssertGreaterThanOrEqual(app.buttons[label].frame.height.rounded(), wide ? 40 : 44, "\(label) is too small to hit")
        }
        if !wide {
            XCTAssertEqual(app.buttons["Other…"].frame.width, app.buttons["Skip"].frame.width, accuracy: 1, "Not two halves")
            XCTAssertEqual(app.buttons["Other…"].frame.minY, app.buttons["Skip"].frame.minY, accuracy: 1, "Not side by side")
        }
        let more = app.buttons["botQuestion.more"]
        XCTAssertGreaterThanOrEqual(more.frame.height.rounded(), 44, "Show more is too small to hit")
        XCTAssertEqual(more.frame.width, options[0].union(app.buttons["Skip"].frame).width, accuracy: 1, "Show more is not full-width")
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

        app.buttons["Skip"].tap()
        XCTAssertTrue(heading.waitForNonExistence(timeout: 5), "Skip left the question in the chat")
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
        XCTAssertTrue(app.buttons["Skip"].exists)

        field.tap()
        field.typeText("fixture-value")
        XCTAssertEqual(field.value as? String, String(repeating: "•", count: 13), "The value is not masked")
        shot("16-bot-chat-secret-typed")
        app.buttons["Send securely"].tap()
        XCTAssertTrue(app.staticTexts["DEPLOY_TOKEN saved on the task's runtime."].waitForExistence(timeout: 10),
                      "The secret was not saved on the conversation that asked")
        XCTAssertFalse(app.buttons["Skip"].exists, "A saved secret can still be skipped")
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
        XCTAssertGreaterThan(app.buttons["Skip"].firstMatch.frame.minY, app.frame.height * 0.7, "The answers cover the question")
        shot("8-words-only-in-view")
    }

    /// #3468: a single- and a multi-select question are the same capsules, "Other…" and "Skip"; a
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
        XCTAssertTrue(app.buttons["Other…"].exists && app.buttons["Skip"].exists)
        XCTAssertFalse(app.buttons["Send"].exists, "A single-select is answered by its option")
        shot("13-inbox-single-select")

        openQuestion("Which regions ship today?")
        XCTAssertTrue(app.buttons["us-east"].waitForExistence(timeout: 10), "No options")
        shot("14-inbox-multi-select")
        let send = app.buttons["Send"]
        XCTAssertTrue(send.waitForExistence(timeout: 10), "No Send for the picks")
        XCTAssertTrue(app.buttons["us-east"].exists && app.buttons["Other…"].exists && app.buttons["Skip"].exists,
                      "The multi-select is not the single-select's capsules")
        XCTAssertFalse(app.textFields["Your answer"].exists, "The text box shows before Other…")
        XCTAssertFalse(app.buttons["Send answer"].exists, "The multi-select is still a form")
        XCTAssertFalse(send.isEnabled, "Send before anything is picked")
        // Where a single-select's options are: pinned under the question on iPhone.
        XCTAssertGreaterThan(app.buttons["Skip"].firstMatch.frame.minY, app.frame.height * 0.7,
                             "The multi-select options are not where a single-select's are")
        app.buttons["us-east"].tap()
        app.buttons["ap-south"].tap()
        XCTAssertTrue(app.buttons["us-east"].isSelected && app.buttons["ap-south"].isSelected && !app.buttons["eu-west"].isSelected,
                      "A tap does not pick, or picks one only")
        XCTAssertTrue(send.isEnabled)
        shot("15-inbox-multi-select-picked")
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

    private func listed(_ question: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier == %@ AND label == %@", "inbox.row", question)).firstMatch
    }

    private func launch(page: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"] + (page.map { ["-page", $0] } ?? [])
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
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
