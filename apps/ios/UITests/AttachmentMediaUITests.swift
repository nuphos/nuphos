import XCTest

/// A message's videos and images open in one viewer: tapping a video opens
/// that video, even beside a wide image, and swiping reaches every item.
/// Tapping an image never waits for the message's videos to download.
/// Uses a copy of the offline chats fixture whose first screenshot group
/// holds a 16:9 video and a 16:9 image.
final class AttachmentMediaUITests: XCTestCase {
    func testVideoOpensItselfAndSwipesToImages() throws {
        let app = try launch(videoLink: "file://$FIXTURE_DIR/media/clip.mp4")

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

    /// The ✕ button closes the viewer, as a pull down does.
    func testCloseButtonClosesViewer() throws {
        let app = try launch(videoLink: "file://$FIXTURE_DIR/media/clip.mp4")
        let image = app.buttons["Open wide.png"]
        XCTAssertTrue(image.waitForExistence(timeout: 10), "The image never showed")
        image.tap()
        let counter = app.staticTexts["2 / 3"]
        XCTAssertTrue(counter.waitForExistence(timeout: 10), "The viewer did not open")
        shot("viewer-open")
        app.buttons["Done"].tap()
        XCTAssertTrue(counter.waitForNonExistence(timeout: 5), "The ✕ button did not close the viewer")
        shot("viewer-closed")
    }

    /// The video's link answers only after 20 s: the image opens at once, and
    /// the video's page fetches it when swiped to.
    func testImageOpensWithoutWaitingForVideo() throws {
        let app = try launch(videoLink: "https://api.preview.invalid/fixture-media/slow.mp4", videoName: "slow.mp4", extra: [
            "GET /fixture-media/slow.mp4": ["status": 200, "body": "", "delayMs": 20000],
        ])
        let image = app.buttons["Open wide.png"]
        XCTAssertTrue(image.waitForExistence(timeout: 10), "The image never showed")
        image.tap()
        XCTAssertTrue(app.staticTexts["2 / 3"].waitForExistence(timeout: 8), "Opening the image waited for the video")
        app.swipeRight()
        XCTAssertTrue(app.staticTexts["1 / 3"].waitForExistence(timeout: 5), "Swiping did not reach the video")
        XCTAssertTrue(app.activityIndicators.firstMatch.waitForExistence(timeout: 5), "The video's page did not show it loading")
        shot("video-loading")
    }

    /// The video's link fails: its page says so, rather than an empty player.
    func testVideoThatFailsToLoadSaysSo() throws {
        let app = try launch(videoLink: "https://api.preview.invalid/fixture-media/gone.mp4", videoName: "gone.mp4", extra: [
            "GET /fixture-media/gone.mp4": ["status": 404, "body": ""],
        ])
        let image = app.buttons["Open wide.png"]
        XCTAssertTrue(image.waitForExistence(timeout: 10), "The image never showed")
        image.tap()
        XCTAssertTrue(app.staticTexts["2 / 3"].waitForExistence(timeout: 8), "The viewer did not open")
        app.swipeRight()
        XCTAssertTrue(app.staticTexts["1 / 3"].waitForExistence(timeout: 5), "Swiping did not reach the video")
        XCTAssertTrue(app.buttons["Couldn't load the video. Try again."].waitForExistence(timeout: 10), "The failed video showed no error")
        shot("video-failed")
    }

    /// Opens the release chat, whose first screenshot group is the video at
    /// `videoLink` and `wide.png`, followed by the fixture's `shot-2.png`.
    private func launch(videoLink: String, videoName: String = "clip.mp4", extra: [String: Any] = [:]) throws -> XCUIApplication {
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "attachment-media-live.json")
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "channel-responses.json"))) as? [String: Any])
        let file = { (id: String, name: String, type: String, link: String) -> [String: Any] in
            ["id": id, "fileName": name, "contentType": type, "status": "ready", "downloadUrl": link]
        }
        responses["GET /agent/conversations/chat-release/attachments/g-shot1"] = ["status": 200, "body": [
            "groupId": "g-shot1", "createdAt": "2026-11-03T09:00:00.000Z", "expiresAt": "2027-12-31T00:00:00.000Z",
            "files": [file("f-\(videoName)", videoName, "video/mp4", videoLink),
                      file("f-wide", "wide.png", "image/png", "file://$FIXTURE_DIR/media/wide.png")],
        ]]
        responses.merge(extra) { $1 }
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        app.staticTexts["release-planning"].firstMatch.tap()
        return app
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
