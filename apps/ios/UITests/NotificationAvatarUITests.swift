import XCTest
import UIKit

/// Exercises the production parser/assets/bitmap renderer without delivering a notification.
final class NotificationAvatarUITests: XCTestCase {
    func testTaskLegacyAndUnknownPayloadsNeverInventIdentity() {
        XCTAssertNil(BotAvatars.notificationIdentity(["sessionId": "legacy-session"]))
        XCTAssertNil(BotAvatars.notificationIdentity(["agentIdentity": ["isBot": false, "avatar": "07-ada", "provider": "codex"]]))
        XCTAssertNil(BotAvatars.notificationIdentity(["agentIdentity": ["isBot": true, "avatar": "99-custom"]]))
        XCTAssertNil(BotAvatars.notificationPNG(avatar: "99-custom", provider: "codex"))
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
