import XCTest

/// Adding a runtime to a computer, under Desktop's rules: offered on a running computer
/// the viewer manages, the same providers in the same order, a signed-out runtime signed
/// in rather than doubled, and a new one taken straight to its sign-in. Which computers
/// qualify is settled in `NewRuntimeTests`; these check the screens. Offline fixture.
final class NewRuntimeUITests: XCTestCase {
    /// A button by its accessibility label, where it has no identifier of its own.
    private func button(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    private func computers() -> XCUIApplication {
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/new-runtime-responses.json")
        let app = XCUIApplication()
        // `-page runtimes` opens the Runtimes page itself, which is what these check; the
        // home toolbar's own way in is #3433's.
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "runtimes"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        // A freshly installed app asks about notifications, and that alert takes every tap.
        let deny = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Don’t Allow"].firstMatch
        if deny.waitForExistence(timeout: 10) { deny.tap() }
        XCTAssertTrue(app.buttons["new-runtime-device:macbook"].waitForExistence(timeout: 60),
                      "The Runtimes page did not load")
        return app
    }

    /// The list draws a computer's rows as they come into view, so a computer further
    /// down is scrolled to rather than waited for.
    private func reveal(_ app: XCUIApplication, _ identifier: String) -> XCUIElement {
        let element = app.buttons[identifier]

        for _ in 0..<5 where !element.exists { app.swipeUp() }

        return element
    }

    func testTheComputersYouManageOfferANewRuntime() {
        let app = computers()
        // Robin's Mac is shared with `use` access, and its section is on screen beside
        // this one, so its having no New runtime is a real absence.
        XCTAssertFalse(app.buttons["new-runtime-device:teammate-mac"].exists, "Use access offers New runtime")
        XCTAssertTrue(reveal(app, "new-runtime-device:mac-mini").exists, "A computer you manage has no New runtime")
    }

    /// Desktop's LOCAL_AGENT_PROVIDERS and newAgentAction: every provider, in that order,
    /// a signed-out one offered its sign-in, and Antigravity's shared sign-in offered to
    /// neither.
    func testTheListOffersDesktopsProvidersAndSignsInASignedOutOne() {
        let app = computers()
        app.buttons["new-runtime-device:macbook"].tap()

        let order = ["claude-code", "codex", "grok", "antigravity", "opencode", "dsh", "hermes", "pi"]
        for provider in order {
            XCTAssertTrue(app.buttons["provider-\(provider)"].waitForExistence(timeout: 15),
                          "\(provider) is missing from the New runtime list")
        }
        let offered = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'provider-'"))
        XCTAssertEqual((0..<offered.count).map { offered.element(boundBy: $0).identifier },
                       order.map { "provider-\($0)" }, "The providers are not in Desktop's order")

        // This computer's Codex is signed out, so that one signs in rather than doubling.
        XCTAssertTrue(text(app, "Sign in to Codex").exists, "A signed-out Codex is not offered its sign-in")
        XCTAssertTrue(text(app, "Claude Code").exists, "Claude Code is not offered as a new runtime")
        XCTAssertTrue(text(app, "DeepSeek Harness · Preview").exists, "DeepSeek Harness is not marked a preview")
        XCTAssertTrue(text(app, "Pi · Preview").exists, "Pi is not marked a preview")
        XCTAssertFalse(app.buttons["provider-antigravity"].isEnabled, "Antigravity is offered as a new runtime")
        XCTAssertTrue(text(app, "Antigravity uses this computer’s shared sign-in").exists,
                      "Antigravity does not say why it is not offered")
    }

    func testANewRuntimeIsNamedThenTakenToItsSignIn() {
        let app = computers()
        reveal(app, "new-runtime-device:mac-mini").tap()
        let opencode = app.buttons["provider-opencode"]
        XCTAssertTrue(opencode.waitForExistence(timeout: 15), "OpenCode is missing from the New runtime list")
        opencode.tap()

        XCTAssertTrue(text(app, "New OpenCode runtime").waitForExistence(timeout: 15), "The settings step did not open")
        let name = app.textFields.firstMatch
        XCTAssertTrue(name.waitForExistence(timeout: 15), "The new runtime has no name field")
        XCTAssertEqual(name.value as? String, "OpenCode", "A new runtime does not start with its provider's name")

        button(app, "Continue").tap()
        // Step three is the same sign-in a listed runtime uses.
        XCTAssertTrue(text(app, "Sign in to OpenCode").waitForExistence(timeout: 60),
                      "The new runtime did not reach its sign-in")
        XCTAssertTrue(button(app, "Cancel").exists, "Leaving the sign-in is the only way to undo the runtime")
    }
}
