import XCTest

extension XCUIApplication {
    /// A chat focuses its composer once it has loaded (#3343), and the keyboard then covers
    /// most of the transcript. Waits for it and swipes the transcript down, as a person would.
    func dismissAutoFocusedKeyboard() {
        let transcript = collectionViews["chat.transcript"].firstMatch
        // The composer focuses only once the chat has loaded.
        guard transcript.waitForExistence(timeout: 10), keyboards.firstMatch.waitForExistence(timeout: 3) else { return }
        transcript.swipeDown()
        XCTAssertTrue(keyboards.firstMatch.waitForNonExistence(timeout: 3), "The keyboard stayed up")
    }
}
