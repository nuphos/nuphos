import XCTest

/// A message's videos and images open in one viewer: tapping a video opens
/// that video, even beside a wide image, and swiping reaches every item.
/// Tapping an image never waits for the message's videos to download, nor
/// downloads the image again.
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

    /// On a video, ✕ and share are finger-sized: a tap near a button's edge,
    /// off its glyph, still works. They keep off the top edge even where the
    /// status bar isn't above them, as on an iPhone Duo.
    func testBarButtonsTakeTapsOffTheirGlyphs() throws {
        let app = try launch(videoLink: "file://$FIXTURE_DIR/media/clip.mp4")
        let video = app.buttons["Open clip.mp4"]
        // A short screen, such as an iPhone Duo's cover, opens the chat below the video.
        for _ in 0..<6 where !video.waitForExistence(timeout: 3) || !video.isHittable { app.swipeDown() }
        XCTAssertTrue(video.waitForExistence(timeout: 10), "The video never showed")
        video.tap()
        let counter = app.staticTexts["1 / 3"]
        XCTAssertTrue(counter.waitForExistence(timeout: 10), "The viewer did not open on the video")
        let done = app.buttons["Done"], share = app.buttons["Share"]
        for button in [done, share] {
            XCTAssertGreaterThanOrEqual(button.frame.width, 44, "\(button.label) is narrower than 44 pt")
            XCTAssertGreaterThanOrEqual(button.frame.height, 44, "\(button.label) is shorter than 44 pt")
            // A touch at the screen's top edge goes to the system first.
            XCTAssertGreaterThanOrEqual(button.frame.minY - app.windows.firstMatch.frame.minY, 20, "\(button.label) touches the top edge")
        }
        shot("video-bar")
        done.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.9)).tap()
        XCTAssertTrue(counter.waitForNonExistence(timeout: 5), "A tap near ✕'s edge did not close the viewer")

        video.tap()
        XCTAssertTrue(counter.waitForExistence(timeout: 10), "The viewer did not reopen on the video")
        share.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.9)).tap()
        XCTAssertTrue(app.otherElements["ActivityListView"].waitForExistence(timeout: 10)
            || app.navigationBars["UIActivityContentView"].exists, "A tap near share's edge did not open the share sheet")
        shot("video-share")
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

    /// The video's link answers only after 20 s: tapping the video opens it
    /// at once, to play from its link, rather than waiting for its download.
    func testVideoOpensWithoutWaitingForItsDownload() throws {
        let app = try launch(videoLink: "https://api.preview.invalid/fixture-media/slow.mp4", videoName: "slow.mp4", extra: [
            "GET /fixture-media/slow.mp4": ["status": 200, "body": "", "delayMs": 20000],
        ])
        let video = app.buttons["Open slow.mp4"]
        XCTAssertTrue(video.waitForExistence(timeout: 10), "The video never showed")
        video.tap()
        XCTAssertTrue(app.staticTexts["1 / 3"].waitForExistence(timeout: 8), "Opening the video waited for its download")
        shot("video-opened")
    }

    /// The video's link fails: its page says so, rather than an empty player.
    /// The player reads the link itself, not through the preview's responses,
    /// so the link is a file that isn't there.
    func testVideoThatFailsToLoadSaysSo() throws {
        let app = try launch(videoLink: "file://$FIXTURE_DIR/media/gone.mp4", videoName: "gone.mp4")
        let image = app.buttons["Open wide.png"]
        XCTAssertTrue(image.waitForExistence(timeout: 10), "The image never showed")
        image.tap()
        XCTAssertTrue(app.staticTexts["2 / 3"].waitForExistence(timeout: 8), "The viewer did not open")
        app.swipeRight()
        XCTAssertTrue(app.staticTexts["1 / 3"].waitForExistence(timeout: 5), "Swiping did not reach the video")
        XCTAssertTrue(app.buttons["Couldn't load the video. Try again."].waitForExistence(timeout: 10), "The failed video showed no error")
        shot("video-failed")
    }

    /// Once its thumbnail shows, an image opens from the bytes the thumbnail
    /// read: its group can no longer be read, and it still opens.
    func testImageOpensFromItsThumbnailsCopy() throws {
        // A new id, so no copy left by an earlier test opens it.
        let app = try launch(videoLink: "file://$FIXTURE_DIR/media/clip.mp4", imageId: "f-wide-\(UUID().uuidString)")
        let image = app.buttons["Open wide.png"]
        XCTAssertTrue(image.waitForExistence(timeout: 10), "The image never showed")
        // The thumbnails are local files; give them a moment to be copied.
        Thread.sleep(forTimeInterval: 2)
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: live)) as? [String: Any])
        for group in ["g-shot1", "g-shot2"] {
            responses["GET /agent/conversations/chat-release/attachments/\(group)"] = ["status": 404, "body": ["error": ["message": "gone"]]]
        }
        try JSONSerialization.data(withJSONObject: responses).write(to: live, options: .atomic)
        image.tap()
        let counter = app.staticTexts["2 / 3"]
        _ = counter.waitForExistence(timeout: 8)
        shot("image-opened-offline")
        XCTAssertTrue(counter.exists, "Opening the image read it again")
        XCTAssertTrue(app.images["wide.png"].exists, "The viewer did not show the image")
    }

    /// Opens the release chat, whose first screenshot group is the video at
    /// `videoLink` and `wide.png`, followed by the fixture's `shot-2.png`.
    private func launch(videoLink: String, videoName: String = "clip.mp4", imageId: String = "f-wide", extra: [String: Any] = [:]) throws -> XCUIApplication {
        let live = live
        var responses = try XCTUnwrap(JSONSerialization.jsonObject(
            with: Data(contentsOf: fixtures.appending(path: "channel-responses.json"))) as? [String: Any])
        let file = { (id: String, name: String, type: String, link: String) -> [String: Any] in
            ["id": id, "fileName": name, "contentType": type, "status": "ready", "downloadUrl": link]
        }
        responses["GET /agent/conversations/chat-release/attachments/g-shot1"] = ["status": 200, "body": [
            "groupId": "g-shot1", "createdAt": "2026-11-03T09:00:00.000Z", "expiresAt": "2027-12-31T00:00:00.000Z",
            "files": [file("f-\(videoName)", videoName, "video/mp4", videoLink),
                      file(imageId, "wide.png", "image/png", "file://$FIXTURE_DIR/media/wide.png")],
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

    private let fixtures = URL(filePath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .appending(path: "tests/fixtures")
    private var live: URL { fixtures.appending(path: "attachment-media-live.json") }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
