import UIKit
import XCTest

/// Tapping a Markdown image in a reply shows that image in the viewer, not a
/// black page, and an image the viewer can't load says so and can be tried
/// again. The image is remote, so this runs from
/// `tests/markdown-image-simulator.sh`, which serves it over local HTTPS;
/// otherwise it is skipped.
final class MarkdownImageUITests: XCTestCase {
    func testRemoteImageShowsInViewer() throws {
        let (app, link) = try launch(file: "wide.png")
        app.buttons["remote shot"].tap()
        let shown = app.images[link.lastPathComponent]
        XCTAssertTrue(shown.waitForExistence(timeout: 10), "The viewer did not open")
        waitForLight(in: shown)
        shot()
        XCTAssertGreaterThan(brightness(of: shown), 0.1, "The viewer stayed black")
    }

    /// The script's server fails the second request for `flaky.png`, which is
    /// the viewer's, and answers the rest.
    func testFailedImageOffersRetry() throws {
        let (app, link) = try launch(file: "flaky.png")
        app.buttons["remote shot"].tap()
        let retry = app.buttons["Couldn't load the image. Try again."]
        XCTAssertTrue(retry.waitForExistence(timeout: 10), "The viewer said nothing when the image failed")
        shot()
        retry.tap()
        let shown = app.images[link.lastPathComponent]
        waitForLight(in: shown)
        shot()
        XCTAssertGreaterThan(brightness(of: shown), 0.1, "Trying again did not show the image")
    }

    /// Opens a chat whose reply has the script's `file` as a Markdown image,
    /// once that image shows in the reply.
    private func launch(file: String) throws -> (XCUIApplication, URL) {
        guard let base = ProcessInfo.processInfo.environment["MARKDOWN_IMAGE_URL"].flatMap(URL.init(string:)) else {
            throw XCTSkip("Run tests/markdown-image-simulator.sh")
        }
        let link = base.deletingLastPathComponent().appending(path: file)
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "markdown-image-live.json")
        let reply = "Type your email and password there."
        let text = try String(contentsOf: fixtures.appending(path: "dock-responses.json"), encoding: .utf8)
            .replacingOccurrences(of: "\(reply)\"", with: "\(reply)\\n\\n![remote shot](\(link.absoluteString))\"")
        try text.write(to: live, atomically: true, encoding: .utf8)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links",
                               "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/dock-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"].firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(app.buttons["remote shot"].waitForExistence(timeout: 30), "The reply's image never showed")
        return (app, link)
    }

    /// The viewer is black behind the image: some light means the image is there.
    private func waitForLight(in element: XCUIElement) {
        let deadline = Date().addingTimeInterval(10)
        while brightness(of: element) < 0.1, Date() < deadline { usleep(250_000) }
    }

    private func shot() {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// The brightest of the element's pixels, scaled down to 16 × 16, from 0 to 1.
    private func brightness(of element: XCUIElement) -> Double {
        guard element.exists, let image = element.screenshot().image.cgImage else { return 0 }
        var pixels = [UInt8](repeating: 0, count: 16 * 16 * 4)
        let context = CGContext(data: &pixels, width: 16, height: 16, bitsPerComponent: 8, bytesPerRow: 64,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        context?.draw(image, in: CGRect(x: 0, y: 0, width: 16, height: 16))
        return Double(pixels.enumerated().filter { $0.offset % 4 != 3 }.map(\.element).max() ?? 0) / 255
    }
}
