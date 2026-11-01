import Foundation

/// Keep this order and hash identical to Desktop's botAvatars.ts.
enum BotAvatars {
    static let enabledKey = "nuphos.botAvatars"

    /// Shared with the notification extension, which shows the avatar on pushes.
    static let defaults: UserDefaults = {
        let shared = UserDefaults(suiteName: "group.ai.nuphos.ios") ?? .standard
        // The setting used to live in the app's own defaults.
        if shared.object(forKey: enabledKey) == nil, let old = UserDefaults.standard.object(forKey: enabledKey) {
            shared.set(old, forKey: enabledKey)
        }
        return shared
    }()

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

    static func asset(for id: String) -> String {
        "bot-avatar-" + file(for: id).replacingOccurrences(of: ".svg", with: "")
    }
}
