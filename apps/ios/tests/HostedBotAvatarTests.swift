import Foundation

@main struct HostedBotAvatarTests {
    static func main() {
        let api = URL(string: "https://api.example.com/v1")!
        let path = "/avatars/" + String(repeating: "a", count: 24) + "/" + String(repeating: "b", count: 64) + ".webp"
        precondition(BotAvatars.uploadedURL("https://api.example.com" + path, apiBase: api) != nil)
        precondition(BotAvatars.uploadedURL("https://api.example.com:443" + path, apiBase: api) != nil)
        precondition(BotAvatars.uploadedURL("https://API.EXAMPLE.COM" + path, apiBase: api) != nil)
        precondition(BotAvatars.uploadedURL("https://api.example.com:8443" + path, apiBase: api) == nil)
        precondition(BotAvatars.uploadedURL("https://api.example.com" + path.replacingOccurrences(of: "/avatars/", with: "/%61vatars/"), apiBase: api) == nil)
        for raw in ["https://evil.example" + path, "http://api.example.com" + path,
                    "https://api.example.com" + path + "?x=1", "https://api.example.com" + path + "#x",
                    "https://user@api.example.com" + path, "01-vermeer-girl", "https://api.example.com/avatars/not-a-bot/a.webp"] {
            precondition(BotAvatars.uploadedURL(raw, apiBase: api) == nil, raw)
        }
        print("Hosted Bot avatar trust tests passed")
    }
}
