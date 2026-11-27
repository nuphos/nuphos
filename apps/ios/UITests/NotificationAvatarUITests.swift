import XCTest
import UIKit

/// Exercises the production parser/assets/bitmap renderer without delivering a notification.
final class NotificationAvatarUITests: XCTestCase {
    func testLegacyAndUnknownPayloadsNeverInventIdentity() {
        XCTAssertNil(BotAvatars.notificationIdentity(["sessionId": "legacy-session"]))
        XCTAssertNil(BotAvatars.notificationIdentity(["agentIdentity": ["isBot": false]]))
        XCTAssertNil(BotAvatars.notificationIdentity(["agentIdentity": ["isBot": true, "avatar": "99-custom"]]))
        XCTAssertNil(BotAvatars.notificationPNG(avatar: "99-custom", provider: "codex"))
        XCTAssertNil(BotAvatars.notificationPNG(avatar: nil, provider: "future-provider"))
    }

    func testTaskWearsItsRuntimeMark() throws {
        let identity = try XCTUnwrap(BotAvatars.notificationIdentity(["agentIdentity": ["isBot": false, "avatar": "07-ada", "provider": "codex"]]))
        XCTAssertNil(identity.avatar)
        let png = try XCTUnwrap(BotAvatars.notificationPNG(avatar: identity.avatar, provider: identity.provider))
        XCTAssertNotEqual(png, BotAvatars.notificationPNG(avatar: nil, provider: "grok"))
        let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
        attachment.name = "notification-task-codex"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testPickedBackgroundSitsBehindTheFace() throws {
        let plain = try XCTUnwrap(BotAvatars.notificationPNG(avatar: "07-ada", provider: nil))
        let mint = try XCTUnwrap(BotAvatars.notificationPNG(avatar: "07-ada", provider: nil, background: "mint"))
        XCTAssertNotEqual(plain, mint)
        XCTAssertEqual(plain, BotAvatars.notificationPNG(avatar: "07-ada", provider: nil, background: "future-tint"))
        XCTAssertEqual(plain, BotAvatars.notificationPNG(avatar: "07-ada", provider: nil, background: "none"))
        for (png, name) in [(mint, "mint"), (plain, "none")] {
            let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
            attachment.name = "notification-ada-\(name)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    /// A Bot with no tint picked sits on an opaque white disc, never a see-through one.
    func testNoTintIsAWhiteDisc() throws {
        let png = try XCTUnwrap(BotAvatars.notificationPNG(avatar: "07-ada", provider: nil))
        let image = try XCTUnwrap(UIImage(data: png)?.cgImage)
        var pixel = [UInt8](repeating: 0, count: 4)
        let context = try XCTUnwrap(CGContext(data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                              space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        // Just inside the disc's top-left edge, clear of the character: shift the image so that point lands on the 1x1 context.
        let x = image.width * 20 / 120, y = image.height * 20 / 120
        context.draw(image, in: CGRect(x: -x, y: -(image.height - 1 - y), width: image.width, height: image.height))
        XCTAssertEqual(pixel, [255, 255, 255, 255])
    }

    func testChosenFaceAndEveryKnownProviderUseTheActualSharedBitmapRenderer() throws {
        let plain = try XCTUnwrap(BotAvatars.notificationPNG(avatar: "07-ada", provider: nil))
        XCTAssertEqual(plain, BotAvatars.notificationPNG(avatar: "07-ada", provider: "future-provider"))
        var images = Set<Data>()
        for provider in ["claude-code", "codex", "grok", "antigravity", "opencode"] {
            let identity = try XCTUnwrap(BotAvatars.notificationIdentity(["agentIdentity": ["isBot": true, "avatar": "07-ada", "provider": provider]]))
            let png = try XCTUnwrap(BotAvatars.notificationPNG(avatar: identity.avatar, provider: identity.provider))
            XCTAssertNotEqual(png, plain, "Known runtime must add its mark, not silently miss its asset")
            XCTAssertTrue(images.insert(png).inserted, "Different providers must not reuse a default logo")
            let bitmap = try XCTUnwrap(UIImage(data: png)?.cgImage)
            XCTAssertEqual(bitmap.width, bitmap.height)
            let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
            attachment.name = "notification-ada-\(provider)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        XCTAssertNotEqual(plain, BotAvatars.notificationPNG(avatar: "02-leonardo", provider: nil))
    }
}
