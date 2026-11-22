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

    /// The Agent page's first page for the team it was showing.
    struct Agents: Codable {
        let team: Team
        let conversations: [AgentConversation]
        var accountKey: String? = nil
    }

    static func accountKey(_ token: String) -> String {
        SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func read<T: Decodable>(_ type: T.Type) -> T? {
        if isPreview { return nil }
        guard let data = try? Data(contentsOf: url(for: type)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func write<T: Encodable>(_ value: T) {
        if isPreview { return }
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url(for: T.self), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// A chat's last full read, so opening it after a launch shows it at once while
    /// it reads again (#3525). Only the chats read last are kept, under their account.
    static func transcript(of channelId: String, token: String) -> Data? {
        if isPreview { return nil }
        return try? Data(contentsOf: transcripts(token).appending(path: "\(channelId).json"))
    }

    static func keepTranscript(_ data: Data, of channelId: String, token: String) {
        if isPreview { return }
        let folder = transcripts(token)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? data.write(to: folder.appending(path: "\(channelId).json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let kept = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        let modified = { (url: URL) in (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast }
        for old in kept.sorted(by: { modified($0) > modified($1) }).dropFirst(20) { try? FileManager.default.removeItem(at: old) }
    }

    private static func transcripts(_ token: String) -> URL {
        directory.appending(path: "transcripts/\(accountKey(token))", directoryHint: .isDirectory)
    }

    static func clear() {
        try? FileManager.default.removeItem(at: directory)
    }

    /// A preview run answers from a fixture, so there is nothing here worth painting and
    /// nothing worth keeping: this cache outlives a launch, and UI test suites share one
    /// installed app, so suite B would open on suite A's conversations.
    private static var isPreview: Bool {
        #if DEBUG
        PreviewIsolation.isActive
        #else
        false
        #endif
    }

    private static let directory = URL.cachesDirectory.appending(path: "launch", directoryHint: .isDirectory)

    private static func url<T>(for type: T.Type) -> URL {
        directory.appending(path: "\(T.self).json")
    }
}
