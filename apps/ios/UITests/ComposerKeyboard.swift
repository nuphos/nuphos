import XCTest

extension XCUIApplication {
    /// A chat focuses its composer once it has loaded (#3343), and the keyboard then covers
    /// most of the transcript. Waits for it and drags the transcript down past it, as a person would.
    func dismissAutoFocusedKeyboard() {
        let transcript = collectionViews["chat.transcript"].firstMatch
        // The composer focuses only once the chat has loaded.
        guard transcript.waitForExistence(timeout: 10), keyboards.firstMatch.waitForExistence(timeout: 3) else { return }
        // The transcript lets the keyboard go only when the finger is dragged down into it; a
        // swipe within the transcript, which ends above the composer, leaves it up.
        transcript.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            .press(forDuration: 0.05, thenDragTo: windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
        XCTAssertTrue(keyboards.firstMatch.waitForNonExistence(timeout: 3), "The keyboard stayed up")
    }
}
