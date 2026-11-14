import Foundation
#if canImport(UIKit)
import UIKit

private final class BotAvatarBundle: NSObject {}
#endif

/// Keep this order and hash identical to Desktop's botAvatars.ts.
enum BotAvatars {
    static let enabledKey = "nuphos.botAvatars"

    /// Shared with the notification extension, which shows the avatar on pushes.
    static let defaults: UserDefaults = {
        migratedDefaults(legacy: .standard, shared: UserDefaults(suiteName: "group.ai.nuphos.ios") ?? .standard)
    }()

    /// Migrate once; later shared-suite changes take precedence over the old value.
    static func migratedDefaults(legacy: UserDefaults, shared: UserDefaults) -> UserDefaults {
        if shared.object(forKey: enabledKey) == nil, let old = legacy.object(forKey: enabledKey) {
            shared.set(old, forKey: enabledKey)
        }
        return shared
    }

    static var enabled: Bool { defaults.object(forKey: enabledKey) as? Bool ?? true }
    static let files = [
        "01-vermeer-girl.svg",
        "02-leonardo.svg",
        "03-mona-lisa.svg",
        "04-venus.svg",
        "05-rembrandt.svg",
        "06-beethoven.svg",
        "07-ada.svg",
        "08-socrates.svg",
        "09-frida.svg",
        "10-van-gogh.svg",
        "11-mozart.svg",
        "12-newton.svg",
        "13-shakespeare.svg",
        "14-napoleon.svg",
        "15-cleopatra.svg",
        "16-athena.svg",
        "17-the-scream.svg",
        "18-american-gothic.svg",
        "19-the-fifer.svg",
        "20-son-of-man.svg",
        "21-the-milkmaid.svg",
        "22-lady-with-an-ermine.svg",
        "23-girl-with-peaches.svg",
        "24-the-blue-boy.svg",
        "25-infanta.svg",
        "26-the-swing.svg",
        "27-the-astronomer.svg",
        "28-the-sleeping-gypsy.svg",
        "29-amelia-earhart.svg",
    ]
    /// Only the first 28 are derived from an ID, so appending a character never changes an Agent's face.
    static let defaultCount = 28

    static func file(for id: String) -> String {
        var hash: UInt32 = 2166136261
        // JS for…of iterates code points, but charCodeAt(0) takes the first UTF-16 unit.
        for scalar in id.unicodeScalars {
            let unit = scalar.value > 0xFFFF ? 0xD800 + ((scalar.value - 0x10000) >> 10) : scalar.value
            hash = (hash ^ unit) &* 16777619
        }
        return files[Int(hash % UInt32(defaultCount))]
    }

    /// The image for a picked face, when this build ships it.
    static func asset(named avatar: String) -> String? {
        files.contains("\(avatar).svg") ? "bot-avatar-" + avatar : nil
    }

    static func asset(for id: String) -> String {
        "bot-avatar-" + file(for: id).replacingOccurrences(of: ".svg", with: "")
    }

    /// Canonical runtime asset mapping shared by the app and notification extension.
    static func runtimeLogo(_ runtime: String?) -> String? {
        switch runtime {
        case "claude-code": "logo-claude"
        case "codex": "logo-openai"
        case "grok": "logo-grok"
        case "antigravity": "logo-antigravity"
        case "opencode": "logo-opencode"
        case "dsh": "logo-deepseek"
        default: nil
        }
    }

    /// Old payloads and Tasks stay ordinary notifications; never derive a persona from an id.
    static func notificationIdentity(_ userInfo: [AnyHashable: Any]) -> (avatar: String, provider: String?)? {
        guard let identity = userInfo["agentIdentity"] as? [String: Any],
              identity["isBot"] as? Bool == true,
              let avatar = identity["avatar"] as? String,
              asset(named: avatar) != nil else { return nil }
        return (avatar, identity["provider"] as? String)
    }


    #if canImport(UIKit)
    /// Bitmap for INPerson, also exercised directly without delivering a notification.
    static func notificationPNG(avatar: String, provider: String?) -> Data? {
        let bundle = Bundle(for: BotAvatarBundle.self)
        guard let asset = asset(named: avatar),
              let face = UIImage(named: asset, in: bundle, compatibleWith: nil) else { return nil }
        let size = CGSize(width: 120, height: 120)
        return UIGraphicsImageRenderer(size: size).pngData { context in
            face.draw(in: CGRect(origin: .zero, size: size))
            if let name = runtimeLogo(provider), let logo = UIImage(named: name, in: bundle, compatibleWith: nil) {
                let disc = CGRect(x: 74, y: 74, width: 32, height: 32)
                UIColor.systemBackground.setFill()
                context.cgContext.fillEllipse(in: disc)
                let mark = provider == "claude-code" ? logo : logo.withTintColor(.label, renderingMode: .alwaysOriginal)
                mark.draw(in: disc.insetBy(dx: 3, dy: 3))
            }
        }
    }
    #endif

}
