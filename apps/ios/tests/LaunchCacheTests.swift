import Foundation

enum LaunchCacheTests {
    static func run() {
        keepsTheListThroughARoundTrip()
        keepsTheUserThroughARoundTrip()
        print("Launch cache passed")
    }

    // The cache is written with the synthesized encoder and read with the
    // hand-written decoders the API uses; a field that does not survive
    // would quietly show a different list at launch.
    private static func keepsTheListThroughARoundTrip() {
        let row = AgentConversation(
            sessionId: "ses_1", teamId: "team-1", title: "Deploy", firstMessage: "Ship it",
            messageCount: 4, createdAt: Date(timeIntervalSince1970: 1_700_000_000.25),
            lastActiveAt: Date(timeIntervalSince1970: 1_700_000_100.5),
            owner: .init(id: "u1", name: "Ada", email: nil, avatarURL: nil, deactivated: nil),
            isOwner: false, readOnly: true, agentRuntime: "codex", runtimeId: "rt1", runtimeLabel: "Mac",
            activeRun: .init(streamId: "st1", startedAt: nil), runtimeState: .object(["phase": .string("idle")]),
            activitySeq: 7, readSeq: 5, parentSessionId: "ses_0"
        )
        let cached = LaunchCache.Agents(
            team: Team(id: "team-1", name: "Team", role: "EDITOR"),
            conversations: [row],
            favorites: SidebarFavorites(entries: [.chat(sessionId: "ses_1", label: "Deploy")], revision: 3)
        )
        let decoded = try! JSONDecoder().decode(LaunchCache.Agents.self, from: JSONEncoder().encode(cached))
        precondition(decoded.team == cached.team)
        precondition(decoded.conversations == cached.conversations)
        precondition(decoded.favorites == cached.favorites)
    }

    private static func keepsTheUserThroughARoundTrip() {
        let cached = LaunchCache.User(
            user: NuphosUser(id: "u1", email: "ada@example.com", name: "Ada", username: "ada", avatarURL: ""),
            aiConsentVersion: "2026-09-28"
        )
        let decoded = try! JSONDecoder().decode(LaunchCache.User.self, from: JSONEncoder().encode(cached))
        precondition(decoded.user == cached.user)
        precondition(decoded.aiConsentVersion == cached.aiConsentVersion)
    }
}
