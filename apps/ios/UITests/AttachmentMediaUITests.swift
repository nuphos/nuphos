import XCTest

/// A message's videos and images open in one viewer: tapping a video opens
/// that video, even beside a wide image, and swiping reaches every item.
/// Uses a copy of the offline chats fixture whose first screenshot group
/// holds a 16:9 video and a 16:9 image.
final class AttachmentMediaUITests: XCTestCase {
    func testVideoOpensItselfAndSwipesToImages() throws {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "attachment-media-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "channel-responses.json"))) as? [String: Any])
        let file = { (id: String, name: String, type: String) -> [String: Any] in
            ["id": id, "fileName": name, "contentType": type, "status": "ready",
             "downloadUrl": "file://$FIXTURE_DIR/media/\(name)"]
        }
        responses["GET /agent/conversations/chat-release/attachments/g-shot1"] = ["status": 200, "body": [
            "groupId": "g-shot1", "createdAt": "2026-11-03T09:00:00.000Z", "expiresAt": "2027-12-31T00:00:00.000Z",
            "files": [file("f-clip", "clip.mp4", "video/mp4"), file("f-wide", "wide.png", "image/png")],
        ]]
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        defer { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        app.staticTexts["release-planning"].firstMatch.tap()

        let video = app.buttons["Open clip.mp4"]
        XCTAssertTrue(video.waitForExistence(timeout: 10), "The video never showed")
        // The right of the video cell, where a wide image's overflow used to take the tap.
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)).tap()
        let counter = app.staticTexts["1 / 3"]
        _ = counter.waitForExistence(timeout: 10)
        shot("video-tapped")
        XCTAssertTrue(counter.exists, "The video did not open first in the viewer")
        XCTAssertTrue(app.descendants(matching: .any)["clip.mp4"].exists, "The viewer did not show the video")

        app.swipeLeft()
        XCTAssertTrue(app.staticTexts["2 / 3"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.images["wide.png"].exists, "Swiping from the video did not reach the image")
        app.swipeLeft()
        XCTAssertTrue(app.staticTexts["3 / 3"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.images["shot-2.png"].exists)
        app.swipeLeft()
        XCTAssertTrue(app.staticTexts["1 / 3"].waitForExistence(timeout: 5), "The viewer did not wrap back to the video")
        shot("wrapped-to-video")

        app.swipeDown()
        XCTAssertTrue(counter.waitForNonExistence(timeout: 5), "A pull down did not close the viewer")
        app.buttons["Open wide.png"].tap()
        XCTAssertTrue(app.staticTexts["2 / 3"].waitForExistence(timeout: 10), "The image did not open at its own place")
        shot("image-tapped")
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
