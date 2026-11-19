import XCTest

/// The desktop is dark whatever the system appearance: its Take over button and, on a wide
/// window, the conversation title above it stay readable (#3594). Offline fixture.
final class DesktopPanelContrastUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        let fixture = URL(filePath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "tests/fixtures/bot-desktop-responses.json")
        app = XCUIApplication()
        app.launchArguments = ["-preview-home", "-preview-no-push", "-page", "chats"]
        app.launchEnvironment = ["NUPHOS_PREVIEW_RESPONSES": fixture.path]
        app.launch()
        app.staticTexts["Sign-in helper"].firstMatch.tap()
        let button = app.buttons["chat.desktop"]
        XCTAssertTrue(button.waitForExistence(timeout: 10), "The Bot's chat has no desktop button")
        button.tap()
        XCTAssertTrue(app.buttons["Close desktop"].waitForExistence(timeout: 10), "The desktop viewer did not open")
    }

    func testTakeOverLabelIsReadable() {
        let takeOver = app.buttons["Take over"]
        XCTAssertTrue(takeOver.waitForExistence(timeout: 10))
        // Inside the capsule: its corners show the black behind it.
        XCTAssertGreaterThan(contrast(of: takeOver, inset: 0.3), 4.5, "Take over's label blends into its fill")
    }

    func testTitleIsReadableBesideDesktop() throws {
        guard UIDevice.current.userInterfaceIdiom == .pad else {
            throw XCTSkip("The desktop opens beside the conversation only on a wide window")
        }
        // The name alone: the title's own element takes the avatar beside it too.
        let title = app.navigationBars.buttons["bot-trigger-entry"].staticTexts["Sign-in helper"].firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(contrast(of: title), 4.5, "The conversation title blends into the desktop behind it")
    }

    /// The WCAG contrast ratio between the darkest and the lightest pixel in the element, less
    /// `inset` of its height on every side: its text against what is behind it.
    private func contrast(of element: XCUIElement, inset: CGFloat = 0) -> Double {
        guard let whole = element.screenshot().image.cgImage else { return 0 }
        let margin = CGFloat(whole.height) * inset
        let crop = CGRect(x: 0, y: 0, width: whole.width, height: whole.height).insetBy(dx: margin, dy: margin)
        guard let cgImage = whole.cropping(to: crop) else { return 0 }
        let width = cgImage.width, height = cgImage.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let context = CGContext(
            data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        context?.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        func linear(_ c: UInt8) -> Double {
            let v = Double(c) / 255
            return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
        }
        var darkest = 1.0, lightest = 0.0
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let l = 0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2])
            darkest = min(darkest, l)
            lightest = max(lightest, l)
        }
        return (lightest + 0.05) / (darkest + 0.05)
    }
}
