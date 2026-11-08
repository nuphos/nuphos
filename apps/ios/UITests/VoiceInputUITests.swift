import XCTest

/// Voice input in a chat: Stop puts what was said into the input, and Send
/// transcribes and posts it. A chat's composer once had no token to
/// transcribe with, so both buttons did nothing.
/// Uses a copy of the offline chats fixture with a canned transcription.
final class VoiceInputUITests: XCTestCase {
    func testStopAndSendInAChat() throws {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/channel-responses.json")
        let live = fixture.deletingLastPathComponent().appending(path: "voice-input-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["POST /teams/64b5f1c2e4b0a1d2c3e4f5a6/voice-transcriptions"] = ["status": 200, "body": ["text": "Ship it", "language": "english"]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        defer { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.resetAuthorizationStatus(for: .microphone)
        addUIInterruptionMonitor(withDescription: "Microphone") { alert in
            let allow = alert.buttons["Allow"]
            guard allow.exists else { return false }
            allow.tap()
            return true
        }
        app.launch()

        app.staticTexts["release-planning"].firstMatch.tap()
        let mic = app.buttons["Voice input"]
        let stop = app.buttons["Finish voice input"]
        let send = app.buttons["Send voice input"]

        startRecording(app, mic: mic, stop: stop)
        stop.tap()
        let input = app.descendants(matching: .any).matching(NSPredicate(format: "value == 'Ship it'")).firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 10), "Stop did not put the transcription into the input")

        startRecording(app, mic: mic, stop: send)
        send.tap()
        let posted = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Ship it Ship it'")).firstMatch
        XCTAssertTrue(posted.waitForExistence(timeout: 10), "Send did not post the transcription")
    }

    /// Taps the microphone and waits until `ready` takes taps; the first
    /// time, the microphone prompt comes up, and touching the app answers it.
    private func startRecording(_ app: XCUIApplication, mic: XCUIElement, stop ready: XCUIElement) {
        XCTAssertTrue(mic.waitForExistence(timeout: 10), "No microphone in the chat composer")
        mic.tap()
        let enabled = NSPredicate(format: "exists == true AND isEnabled == true")
        for _ in 0..<5 where XCTWaiter.wait(for: [expectation(for: enabled, evaluatedWith: ready)], timeout: 3) != .completed {
            app.swipeUp()
        }
        XCTAssertTrue(ready.isEnabled, "Voice input never started recording")
    }
}
