import UIKit
import XCTest

/// Tapping a Markdown image in a reply shows that image in the viewer, not a
/// black page. The image is remote, so this runs from
/// `tests/markdown-image-simulator.sh`, which serves it over local HTTPS;
/// otherwise it is skipped.
final class MarkdownImageUITests: XCTestCase {
    func testRemoteImageShowsInViewer() throws {
        guard let link = ProcessInfo.processInfo.environment["MARKDOWN_IMAGE_URL"] else {
            throw XCTSkip("Run tests/markdown-image-simulator.sh")
        }
        let fixtures = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures")
        let live = fixtures.appending(path: "markdown-image-live.json")
        let reply = "Type your email and password there."
        let text = try String(contentsOf: fixtures.appending(path: "dock-responses.json"), encoding: .utf8)
            .replacingOccurrences(of: "\(reply)\"", with: "\(reply)\\n\\n![remote shot](\(link))\"")
        try text.write(to: live, atomically: true, encoding: .utf8)
        addTeardownBlock { try? FileManager.default.removeItem(at: live) }

        let app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-open-links",
                               "https://nuphos.ai/teams/64b5f1c2e4b0a1d2c3e4f5a6/agent/dock-a"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": live.path]
        app.launch()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }

        let inline = app.buttons["remote shot"]
        XCTAssertTrue(inline.waitForExistence(timeout: 30), "The reply's image never showed")
        inline.tap()
        let shown = app.images[URL(string: link)!.lastPathComponent]
        XCTAssertTrue(shown.waitForExistence(timeout: 10), "The viewer did not open")
        // The viewer is black behind the image: some light means the image is there.
        let deadline = Date().addingTimeInterval(10)
        while brightness(of: shown) < 0.1, Date() < deadline { usleep(250_000) }
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.lifetime = .keepAlways
        add(attachment)
        XCTAssertGreaterThan(brightness(of: shown), 0.1, "The viewer stayed black")
    }

    /// The brightest of the element's pixels, scaled down to 16 × 16, from 0 to 1.
    private func brightness(of element: XCUIElement) -> Double {
        guard let image = element.screenshot().image.cgImage else { return 0 }
        var pixels = [UInt8](repeating: 0, count: 16 * 16 * 4)
        let context = CGContext(data: &pixels, width: 16, height: 16, bitsPerComponent: 8, bytesPerRow: 64,
                                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        context?.draw(image, in: CGRect(x: 0, y: 0, width: 16, height: 16))
        return Double(pixels.enumerated().filter { $0.offset % 4 != 3 }.map(\.element).max() ?? 0) / 255
    }
}
