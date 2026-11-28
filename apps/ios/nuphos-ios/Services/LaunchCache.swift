import Foundation
import CryptoKit

/// What the last launch showed, so the next one can paint it at once and
/// refresh behind it. Only a convenience: a missing or unreadable file means
/// a normal launch, and signing out deletes it.
enum LaunchCache {
    /// The signed-in user, for opening Home before `/auth/me` answers. Kept
    /// only with the AI notice version it was accepted under.
    struct User: Codable {
        let user: NuphosUser
        let aiConsentVersion: String
    }

    /// The home lists for the team they were showing: the Agent page's first
    /// page, and the chats and Bots when they had loaded.
    struct Agents: Codable {
        let team: Team
        let conversations: [AgentConversation]
        var accountKey: String? = nil
        var channels: [AgentConversation]? = nil
        var bots: [AgentConversation]? = nil
    }

    static func accountKey(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func read<T: Decodable>(_ type: T.Type) -> T? {
        guard let directory, let data = try? Data(contentsOf: directory.appending(path: "\(T.self).json")) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func write<T: Encodable>(_ value: T) {
        guard let directory, let data = try? JSONEncoder().encode(value) else { return }
        save(data, to: directory.appending(path: "\(T.self).json"))
    }

    /// The last read of a chat, by name, so it opens on what it showed while it is read
    /// again, after a relaunch too. Only the chats read last are kept.
    static func chat(_ name: String, token: String) -> Data? {
        guard let url = chatURL(name, token: token) else { return nil }
        return try? Data(contentsOf: url)
    }

    static func storeChat(_ data: Data, as name: String, token: String) {
        guard let url = chatURL(name, token: token) else { return }
        save(data, to: url)
        let keys: Set<URLResourceKey> = [.contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: url.deletingLastPathComponent(), includingPropertiesForKeys: Array(keys)), files.count > chatLimit else { return }
        let date = { (file: URL) in (try? file.resourceValues(forKeys: keys))?.contentModificationDate ?? .distantPast }
        for file in files.sorted(by: { date($0) > date($1) }).dropFirst(chatLimit) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    /// A chat keeps its read and, for a group chat, its agents: about twenty chats.
    static let chatLimit = 40

    static func clear() {
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory)
    }

    private static func save(_ data: Data, to url: URL) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private static func chatURL(_ name: String, token: String) -> URL? {
        directory?.appending(path: "chats/\(accountKey(token).prefix(16))-\(name).json")
    }

    /// A preview run answers from a fixture, so there is nothing here worth painting and
    /// nothing worth keeping: this cache outlives a launch, and UI test suites share one
    /// installed app, so suite B would open on suite A's conversations. A test that
    /// relaunches onto its own cache names one, which no other run reads.
    private static var directory: URL? {
        #if DEBUG
        if PreviewIsolation.isActive {
            guard let run = ProcessInfo.processInfo.environment["NUPHOS_PREVIEW_LAUNCH_CACHE"] else { return nil }
            return URL.cachesDirectory.appending(path: "launch-preview-\(run)", directoryHint: .isDirectory)
        }
        #endif
        return URL.cachesDirectory.appending(path: "launch", directoryHint: .isDirectory)
    }
}
