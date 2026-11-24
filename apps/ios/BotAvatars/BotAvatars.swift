import Foundation
#if canImport(UIKit)
import UIKit

private final class BotAvatarBundle: NSObject {}
#endif

/// Keep this order and hash identical to Desktop's botAvatars.ts.
enum BotAvatars {
    /// Uploaded Bot photos belong only to the backend currently in use.
    static func uploadedURL(_ raw: String, apiBase: URL) -> URL? {
        func port(_ url: URL) -> Int? {
            url.port ?? (url.scheme?.lowercased() == "https" ? 443 : url.scheme?.lowercased() == "http" ? 80 : nil)
        }
        guard raw.count <= 2048, let url = URL(string: raw),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.scheme?.lowercased() == apiBase.scheme?.lowercased(), url.host?.lowercased() == apiBase.host?.lowercased(),
              url.host != nil, port(url) == port(apiBase),
              ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              (URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? "").range(of: #"^/avatars/[0-9a-f]{24}/[0-9a-f]{64}\.webp$"#, options: .regularExpression) != nil
        else { return nil }
        return url
    }

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
        case "hermes": "logo-hermes"
        case "pi": "logo-pi"
        default: nil
        }
    }

    /// The tints a Bot's character may sit on (`avatar.*` in packages/design-tokens).
    /// The characters are drawn for light discs, so the tints stay light in the dark.
    static let backgrounds: [String: UInt32] = [
        "sand": 0xF2E7D3, "peach": 0xF8DCCB, "rose": 0xF6D5DE, "lilac": 0xE5DCF5,
        "sky": 0xD6E6F7, "mint": 0xD3EEDF, "sage": 0xE1E9D1, "slate": 0xE1E4EA,
    ]

    /// A Bot shows its own face; a Task (no avatar) its runtime's mark. Old payloads,
    /// unknown faces and runtimes this build has no logo for keep the app icon.
    static func notificationIdentity(_ userInfo: [AnyHashable: Any]) -> (avatar: String?, provider: String?, background: String?)? {
        guard let identity = userInfo["agentIdentity"] as? [String: Any] else { return nil }
        let provider = identity["provider"] as? String
        guard identity["isBot"] as? Bool == true else { return runtimeLogo(provider) == nil ? nil : (nil, provider, nil) }
        guard let avatar = identity["avatar"] as? String, asset(named: avatar) != nil else { return nil }
        return (avatar, provider, identity["background"] as? String)
    }


    #if canImport(UIKit)
    /// Bitmap for INPerson, also exercised directly without delivering a notification.
    static func notificationPNG(avatar: String?, provider: String?, background: String? = nil) -> Data? {
        let bundle = Bundle(for: BotAvatarBundle.self)
        let logo = runtimeLogo(provider).flatMap { UIImage(named: $0, in: bundle, compatibleWith: nil) }
        let mark = provider == "claude-code" ? logo : logo?.withTintColor(.label, renderingMode: .alwaysOriginal)
        let size = CGSize(width: 120, height: 120)
        guard let avatar else {
            guard let mark else { return nil }
            return UIGraphicsImageRenderer(size: size).pngData { context in
                UIColor.systemBackground.setFill()
                context.fill(CGRect(origin: .zero, size: size))
                mark.draw(in: CGRect(x: 30, y: 30, width: 60, height: 60))
            }
        }
        guard let asset = asset(named: avatar),
              let face = UIImage(named: asset, in: bundle, compatibleWith: nil) else { return nil }
        return UIGraphicsImageRenderer(size: size).pngData { context in
            if let tint = background.flatMap({ backgrounds[$0] }) {
                UIColor(red: CGFloat(tint >> 16 & 0xFF) / 255, green: CGFloat(tint >> 8 & 0xFF) / 255,
                        blue: CGFloat(tint & 0xFF) / 255, alpha: 1).setFill()
                context.cgContext.fillEllipse(in: CGRect(origin: .zero, size: size))
            }
            face.draw(in: CGRect(origin: .zero, size: size))
            if let mark {
                let disc = CGRect(x: 74, y: 74, width: 32, height: 32)
                UIColor.systemBackground.setFill()
                context.cgContext.fillEllipse(in: disc)
                mark.draw(in: disc.insetBy(dx: 3, dy: 3))
            }
        }
    }
    #endif

}
