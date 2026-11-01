import Foundation

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

    /// The Agent page's first page and pins for the team it was showing.
    struct Agents: Codable {
        let team: Team
        let conversations: [AgentConversation]
        let favorites: SidebarFavorites?
    }

    static func read<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? Data(contentsOf: url(for: type)) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    static func write<T: Encodable>(_ value: T) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url(for: T.self), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clear() {
        try? FileManager.default.removeItem(at: directory)
    }

    private static let directory = URL.cachesDirectory.appending(path: "launch", directoryHint: .isDirectory)

    private static func url<T>(for type: T.Type) -> URL {
        directory.appending(path: "\(T.self).json")
    }
}
