import XCTest

/// What render_artifact and render_chart made shows as cards that open over the chat,
/// in a Task and in a Bot's chat, whose posts never carry the Bot's tool calls (#5272).
/// Offline fixture with made-up chats.
final class ToolCardUITests: XCTestCase {
    private var app: XCUIApplication!

    private func launch(_ arguments: [String]) {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/tool-card-responses.json")
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"] + arguments
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
    }

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func assertCardsOpen(_ name: String) {
        let artifact = element("artifact.card"), chart = element("chart.card")
        XCTAssertTrue(artifact.waitForExistence(timeout: 15), "The artifact has no card")
        XCTAssertTrue(chart.exists, "The chart has no card")
        XCTAssertTrue(app.staticTexts["Lisbon itinerary"].exists)
        XCTAssertTrue(app.staticTexts["Trip budget (EUR)"].exists)
        shot("\(name)-cards")

        artifact.tap()
        XCTAssertTrue(element("artifact.page").waitForExistence(timeout: 10), "The artifact did not open")
        XCTAssertTrue(app.staticTexts["Lisbon, two days"].waitForExistence(timeout: 10), "The artifact's page did not draw")
        shot("\(name)-artifact-open")
        element("toolCard.close").tap()

        XCTAssertTrue(chart.waitForExistence(timeout: 10))
        chart.tap()
        XCTAssertTrue(element("toolCard.panel").waitForExistence(timeout: 10), "The chart did not open")
        shot("\(name)-chart-open")
        element("toolCard.close").tap()
    }

    func testATasksArtifactAndChartAreCards() {
        launch(["-open-links", "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/task-cards"])
        assertCardsOpen("task")
    }

    func testABotsChatShowsWhatTheBotMade() {
        launch(["-page", "chats"])
        let row = app.staticTexts["Trip planner"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "The Bots page does not list Trip planner")
        row.tap()
        assertCardsOpen("bot")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
