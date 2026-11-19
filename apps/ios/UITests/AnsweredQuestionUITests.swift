import XCTest

/// Offline: a question answered from the Inbox reads as who answered what, never as the agent's notice.
final class AnsweredQuestionUITests: XCTestCase {
    func testAnsweredQuestionsAreOneLineEachAndOpenToTheirCard() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let live = FileManager.default.temporaryDirectory.appending(path: "answered-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var conversation = try XCTUnwrap(responses["GET /agent/conversations/push-a"] as? [String: Any])
        var body = try XCTUnwrap(conversation["body"] as? [String: Any])
        let context = "The migration touches the `sessions` table.\n\n- **Online** keeps the API up.\n- **Offline** needs a 20 minute window."
        func card(_ id: String, _ input: [String: Any]) -> [String: Any] {
            ["id": "ask-\(id)", "role": "assistant", "createdAt": "2026-11-14T01:12:00Z", "parts": [[
                "type": "dynamic-tool", "toolCallId": id, "toolName": "request_user_decision",
                "state": "output-available", "input": input, "output": ["requestId": id],
            ]]]
        }
        func notice(_ id: String, _ lines: [String]) -> [String: Any] {
            ["id": "notice-\(id)", "role": "user", "createdAt": "2026-11-14T01:47:00Z",
             "parts": [["type": "text", "text": ([
                "Your question (requestId \(id)) was answered from the Inbox.",
                "Answered by: \"Jamie Doe\", this conversation's owner: it is their own answer.",
             ] + lines + ["Continue the task with this answer."]).joined(separator: "\n")]],
             "metadata": ["version": 1, "source": "agent.resource", "sentAt": "2026-11-14T01:47:00Z",
                          "sender": ["type": "system", "id": "nuphos:decision", "displayName": "Nuphos"]]]
        }
        body["messages"] = [
            card("q-8f2c1a", ["category": "approval", "question": "How should I run the sessions migration?", "body": context,
                              "options": ["Online, about 3 hours", "Offline, 20 minute window", "Not yet"]]),
            notice("q-8f2c1a", ["Question: How should I run the sessions migration?", "Context you gave: \(context)",
                                "Options: Online, about 3 hours | Offline, 20 minute window | Not yet",
                                "Answer:", "- How should I run the sessions migration? → Online, about 3 hours",
                                "About: 5d0a6c1e-7b1f-4a52-9c0e-2f6d1b7a9e31"]),
            card("q-31aa", ["category": "preference", "question": "Release settings", "questions": [
                ["question": "Which platforms ship today?", "options": ["Desktop", "iOS", "Android"], "multiSelect": true],
                ["question": "What goes in the changelog?", "options": ["Nothing"]],
            ]]),
            notice("q-31aa", ["Question: Release settings", "Answer:", "- Which platforms ship today? → Desktop, iOS",
                              "- What goes in the changelog? → One line about the answered notice, nothing else."]),
        ]
        conversation["body"] = body
        responses["GET /agent/conversations/push-a"] = conversation
        responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": []]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let lines = app.buttons.matching(identifier: "answered.line")
        XCTAssertTrue(lines.firstMatch.waitForExistence(timeout: 10))
        XCTAssertEqual(lines.count, 3, "One line per question answered")
        XCTAssertGreaterThanOrEqual(lines.firstMatch.frame.height, 44)
        let machine = NSPredicate(format: "label CONTAINS 'requestId' OR label CONTAINS 'About:' OR label CONTAINS 'Continue the task'")
        XCTAssertEqual(app.descendants(matching: .any).matching(machine).count, 0)
        attach(app, "Answered questions · collapsed · light")

        lines.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Offline, 20 minute window"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.descendants(matching: .any).matching(machine).count, 0)
        attach(app, "Answered question · a choice, expanded · light")
        lines.element(boundBy: 0).tap()
        lines.element(boundBy: 1).tap()
        lines.element(boundBy: 2).tap()
        XCTAssertTrue(app.staticTexts["Android"].waitForExistence(timeout: 5))
        attach(app, "Answered questions · several and a typed answer, expanded · light")
    }

    /// #3055: an answer its agent could not run yet says, under its line, what it waits for.
    func testAnAnswerWaitingForItsAgentSaysWhy() throws {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/push-responses.json")
        let live = FileManager.default.temporaryDirectory.appending(path: "waiting-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: live) }
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        var conversation = try XCTUnwrap(responses["GET /agent/conversations/push-a"] as? [String: Any])
        var body = try XCTUnwrap(conversation["body"] as? [String: Any])
        let note = "Answered · waiting for Claude Code (out of usage until 11:20 UTC)"
        body["messages"] = [
            ["id": "ask-q-77", "role": "assistant", "createdAt": "2026-11-16T11:05:00Z", "parts": [[
                "type": "dynamic-tool", "toolCallId": "q-77", "toolName": "request_user_decision",
                "state": "output-available", "output": ["requestId": "q-77"],
                "input": ["category": "preference", "question": "Which hero layout should I ship?",
                          "options": ["Split, image right", "Full-bleed image", "Not yet"]],
            ]]],
            ["id": "notice-q-77", "role": "user", "createdAt": "2026-11-16T11:09:00Z",
             "parts": [["type": "text", "text": [
                "Your question (requestId q-77) was answered from the Inbox.",
                "Answered by: \"Yuanlin\", this conversation's owner: it is their own answer.",
                "Question: Which hero layout should I ship?", "Answer:",
                "- Which hero layout should I ship? → Split, image right", "Continue the task with this answer.",
             ].joined(separator: "\n")]],
             "metadata": ["version": 1, "source": "agent.resource", "sentAt": "2026-11-16T11:09:00Z",
                          "sender": ["type": "system", "id": "nuphos:decision", "displayName": "Nuphos"]]],
        ]
        body["waitingAnswers"] = [["requestId": "q-77", "note": note]]
        conversation["body"] = body
        responses["GET /agent/conversations/push-a"] = conversation
        responses["GET /agent/conversations?kind=channel"] = ["status": 200, "body": ["conversations": []]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live)

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "agent", "-open-links",
            "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/push-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        XCTAssertTrue(app.buttons.matching(identifier: "answered.line").firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts[note].waitForExistence(timeout: 5), "The line says what the answer waits for")
        attach(app, "An answer waiting for its agent · light")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
