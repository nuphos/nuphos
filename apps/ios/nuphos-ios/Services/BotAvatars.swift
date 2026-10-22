import Foundation

/// Keep this order and hash identical to Desktop's botAvatars.ts.
enum BotAvatars {
    static let enabledKey = "nuphos.botAvatars"
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
    ]

    static func file(for id: String) -> String {
        var hash: UInt32 = 2166136261
        // JS for…of iterates code points, but charCodeAt(0) takes the first UTF-16 unit.
        for scalar in id.unicodeScalars {
            let unit = scalar.value > 0xFFFF ? 0xD800 + ((scalar.value - 0x10000) >> 10) : scalar.value
            hash = (hash ^ unit) &* 16777619
        }
        return files[Int(hash % UInt32(files.count))]
    }

    static func asset(for id: String) -> String {
        "bot-avatar-" + file(for: id).replacingOccurrences(of: ".svg", with: "")
    }
}
