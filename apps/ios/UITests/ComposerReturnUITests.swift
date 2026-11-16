import UIKit
import XCTest

/// Return on a hardware keyboard in a Bot's chat composer (#2154). Shift-Return
/// is covered by ComposerReturnTests. Offline fixture, with a reply for the
/// post so a sent draft is not handed back.
final class ComposerReturnUITests: XCTestCase {
    private var live: [URL] = []

    override func tearDownWithError() throws {
        for file in live { try? FileManager.default.removeItem(at: file) }
    }

    func testReturnSendsAndKeepsFocus() throws {
        let composer = try openComposer()
        composer.typeText("two")
        composer.typeKey(.return, modifierFlags: [])
        expectation(for: NSPredicate(format: "NOT (value CONTAINS %@)", "two"), evaluatedWith: composer)
        waitForExpectations(timeout: 5)

        // Still focused, so the next message can be typed straight away.
        composer.typeText("three")
        XCTAssertEqual(composer.value as? String, "three")
    }

    /// Needs Zhuyin as the simulator's keyboard; skips when keys still type Latin letters.
    func testReturnWhileComposingKeepsTheText() throws {
        let composer = try openComposer()
        for key in ["s", "u", "3"] { composer.typeKey(key, modifierFlags: []) }  // ㄋㄧˇ
        let composed = composer.value as? String ?? ""
        try XCTSkipIf(composed.contains("su3") || composed.isEmpty, "Zhuyin is not the active input method")

        composer.typeKey(.return, modifierFlags: [])
        let committed = composer.value as? String ?? ""
        XCTAssertFalse(committed.isEmpty, "Return while composing lost the text or sent it")

        // Still focused: the next syllable lands in the composer.
        for key in ["c", "l", "3"] { composer.typeKey(key, modifierFlags: []) }  // ㄏㄠˇ
        composer.typeKey(.return, modifierFlags: [])
        XCTAssertGreaterThan((composer.value as? String ?? "").count, committed.count, "The composer lost focus")
    }

    /// The same case without depending on the simulator's input method: the
    /// app starts the composer with marked text (setMarkedText), and Return
    /// still comes from the hardware key path.
    func testReturnCommitsMarkedText() throws {
        let composer = try openComposer(markedText: true)
        let marked = NSPredicate(format: "value == %@", "ㄋㄧˇ")
        expectation(for: marked, evaluatedWith: composer)
        waitForExpectations(timeout: 5)

        composer.typeKey(.return, modifierFlags: [])
        sleep(2)
        let committed = composer.value as? String ?? ""
        XCTAssertTrue(committed.hasPrefix("ㄋㄧˇ"), "Return while composing lost the text or sent it: \(committed)")

        composer.typeText("ok")
        let next = composer.value as? String ?? ""
        XCTAssertTrue(next.hasPrefix("ㄋㄧˇ") && next.hasSuffix("ok"), "The composer lost focus: \(next)")
    }

    /// What the text view must still do besides Return: the placeholder, a
    /// final line break counted as a line, growing to eight lines and then
    /// scrolling, and an image paste. Screenshots go to NUPHOS_SHOTS when set.
    func testFieldGrowsScrollsAndPastes() throws {
        let composer = try openComposer(hardwareKeys: false)
        shot("1-placeholder")
        let oneLine = composer.frame.height
        composer.typeText("one\n")
        shot("2-line-break-at-end")
        XCTAssertGreaterThan(composer.frame.height, oneLine, "A final line break was not counted as a line")
        var eightLines: CGFloat = 0
        for line in 2...10 {
            composer.typeText("line \(line)")
            if line < 10 { composer.typeText("\n") }
            if line == 8 {
                shot("3-eight-lines")
                eightLines = composer.frame.height
            }
        }
        shot("4-ten-lines-scrolls")
        XCTAssertGreaterThan(eightLines, oneLine * 4, "The field did not grow with its lines")
        XCTAssertEqual(composer.frame.height, eightLines, accuracy: 1, "The field kept growing past eight lines")

        let empty = try openComposer(hardwareKeys: false)

        UIPasteboard.general.image = UIGraphicsImageRenderer(size: CGSize(width: 120, height: 80)).image { context in
            UIColor.systemTeal.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 120, height: 80))
        }
        let paste = XCUIApplication().menuItems["Paste"]
        empty.tap()
        if !paste.waitForExistence(timeout: 2) { empty.press(forDuration: 1) }
        XCTAssertTrue(paste.waitForExistence(timeout: 3), "No Paste in the edit menu")
        paste.tap()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow Paste"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        sleep(2)
        shot("5-image-pasted")
    }

    /// A last line that exactly fills the width stays one line tall, one more
    /// character wraps, and the placeholder is back once the draft is deleted.
    func testLastLineFillingTheWidth() throws {
        let composer = try openComposer(hardwareKeys: false)
        let app = XCUIApplication()
        let fullWidth = app.windows.firstMatch.frame.width * 0.7
        XCTAssertGreaterThan(composer.frame.width, fullWidth, "The empty field is not a full line wide")
        let oneLine = composer.frame.height
        var count = 0
        while composer.frame.height <= oneLine + 1, count < 200 {
            composer.typeText("WWWWW")
            count += 5
        }
        while composer.frame.height > oneLine + 1, count > 0 {
            composer.typeText(XCUIKeyboardKey.delete.rawValue)
            count -= 1
        }
        shot("7-last-line-full")
        composer.typeText("W")
        shot("8-one-more-character")
        XCTAssertGreaterThan(composer.frame.height, oneLine + 1, "One more character did not wrap")

        composer.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: count + 1))
        shot("9-placeholder-after-editing")
        XCTAssertEqual(composer.value as? String ?? "", composer.placeholderValue ?? "", "The draft was not deleted")
        XCTAssertEqual(composer.frame.height, oneLine, accuracy: 1, "The empty field is not one line tall")
        XCTAssertGreaterThan(composer.frame.width, fullWidth, "The emptied field is not a full line wide")
        expectation(for: NSPredicate(format: "isEnabled == false"), evaluatedWith: app.buttons["Send"])
        waitForExpectations(timeout: 3)
    }

    /// The on-screen keyboard's Return types a line break and never sends.
    func testOnScreenReturnTypesALine() throws {
        let composer = try openComposer(hardwareKeys: false)
        let keyboard = XCUIApplication().keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "No on-screen keyboard")
        composer.typeText("one")
        keyboard.buttons.matching(NSPredicate(format: "label ==[c] %@", "return")).firstMatch.tap()
        composer.typeText("two")
        shot("6-on-screen-return")
        XCTAssertEqual(composer.value as? String, "one\ntwo", "The on-screen Return did not type a line break")
    }

    private func shot(_ name: String) {
        guard let dir = ProcessInfo.processInfo.environment["NUPHOS_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(filePath: dir).appending(path: "\(name).png"))
    }

    /// Hardware key presses only reach the app on an iPad simulator; the
    /// on-screen keyboard and pasteboard tests run anywhere.
    private func openComposer(markedText: Bool = false, hardwareKeys: Bool = true) throws -> XCUIElement {
        if hardwareKeys {
            try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "Hardware key presses need an iPad")
        }
        let fixture = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        let file = fixture.deletingLastPathComponent().appending(path: "return-live-\(UUID().uuidString).json")
        live.append(file)
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: fixture)) as? [String: Any])
        responses["POST /agent/conversations/chat-bot-plain/channel-messages"] = ["status": 200, "body": [String: Any]()]
        try JSONSerialization.data(withJSONObject: responses).write(to: file, options: .atomic)
        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"] + (markedText ? ["-preview-marked-text"] : [])
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": file.path]
        app.launch()

        app.staticTexts["Release notes"].firstMatch.tap()
        XCTAssertTrue(app.collectionViews["chat.transcript"].cells.firstMatch.waitForExistence(timeout: 10),
                      "The Bot's chat did not load")
        let composer = try XCTUnwrap([app.textViews.firstMatch, app.textFields.firstMatch].first { $0.exists }, "No composer")
        composer.tap()
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        return composer
    }
}
