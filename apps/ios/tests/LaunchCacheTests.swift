import Foundation

enum LaunchCacheTests {
    static func run() {
        keepsTheListThroughARoundTrip()
        keepsTheUserThroughARoundTrip()
        keepsTheChatsWithTheList()
        keepsTheChatsReadLast()
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
            conversations: [row]
        )
        let decoded = try! JSONDecoder().decode(LaunchCache.Agents.self, from: JSONEncoder().encode(cached))
        precondition(decoded.team == cached.team)
        precondition(decoded.conversations == cached.conversations)
    }

    private static func keepsTheUserThroughARoundTrip() {
        let cached = LaunchCache.User(
            user: NuphosUser(id: "u1", email: "ada@example.com", name: "Ada", username: "ada", avatarURL: ""),
            aiConsentVersion: "2026-11-23"
        )
        let decoded = try! JSONDecoder().decode(LaunchCache.User.self, from: JSONEncoder().encode(cached))
        precondition(decoded.user == cached.user)
        precondition(decoded.aiConsentVersion == cached.aiConsentVersion)
    }

    /// The chats and Bots ride with the list; a file from before them still opens the list.
    private static func keepsTheChatsWithTheList() {
        let team = Team(id: "team-1", name: "Team", role: "EDITOR")
        let chat = AgentConversation(
            sessionId: "chat_1", teamId: "team-1", title: "Release", messageCount: 2,
            createdAt: Date(timeIntervalSince1970: 1_700_000_000), lastActiveAt: Date(timeIntervalSince1970: 1_700_000_050)
        )
        let cached = LaunchCache.Agents(team: team, conversations: [], accountKey: "k", channels: [chat], bots: [])
        let decoded = try! JSONDecoder().decode(LaunchCache.Agents.self, from: JSONEncoder().encode(cached))
        precondition(decoded.channels == [chat])
        precondition(decoded.bots == [])
        let older = try! JSONDecoder().decode(LaunchCache.Agents.self, from: JSONEncoder().encode(
            LaunchCache.Agents(team: team, conversations: [], accountKey: "k")))
        precondition(older.channels == nil, "a list kept without its chats must not show an empty Chats tab")
    }

    /// A chat's read comes back for the account that read it, and only the latest are kept.
    private static func keepsTheChatsReadLast() {
        LaunchCache.clear()
        defer { LaunchCache.clear() }
        let read = Data(#"{"messages":[]}"#.utf8)
        LaunchCache.storeChat(read, as: "ses_1", token: "alice")
        precondition(LaunchCache.chat("ses_1", token: "alice") == read)
        precondition(LaunchCache.chat("ses_1", token: "bob") == nil, "another account must not open on this read")
        for i in 0..<(LaunchCache.chatLimit + 5) { LaunchCache.storeChat(read, as: "more_\(i)", token: "alice") }
        let kept = (0..<(LaunchCache.chatLimit + 5)).filter { LaunchCache.chat("more_\($0)", token: "alice") != nil }
        precondition(kept.count <= LaunchCache.chatLimit, "kept \(kept.count) chats")
        LaunchCache.clear()
        precondition(LaunchCache.chat("more_0", token: "alice") == nil, "signing out must drop every chat")
    }
}
