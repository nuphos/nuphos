import Foundation

/// Thin client for api.nuphos.ai, or the self-hosted backend chosen on the
/// sign-in screen (`NuphosAPIBase.swift`). Every call takes the bearer token;
/// the session owns it.
extension NuphosAPI {
    // MARK: - Endpoints

    /// `GET /auth/me` — the same call the landing page's `getCurrentUser` makes.
    static func currentUser(token: String) async throws -> NuphosUser {
        try await get("auth/me", token: token, timeout: 10)
    }

    /// `GET /teams`. The desktop allows a long timeout here.
    static func teams(token: String) async throws -> [Team] {
        struct Envelope: Decodable { let teams: [Team] }
        let envelope: Envelope = try await get("teams", token: token, timeout: 60)
        return envelope.teams
    }

    /// `GET /teams/:id/members?includeRemoved=true`. Removed members are
    /// included so a plan by a since-departed teammate still resolves to a
    /// name and avatar.
    static func teamMembers(token: String, teamId: String, includeRemoved: Bool = true) async throws -> [TeamMember] {
        struct Envelope: Decodable { let members: [TeamMember] }
        let envelope: Envelope = try await get(
            "teams/\(teamId)/members",
            query: includeRemoved ? [URLQueryItem(name: "includeRemoved", value: "true")] : [],
            token: token, timeout: 20
        )
        return envelope.members
    }

    /// `GET /agent/conversations`. `teamId` is mandatory; `cursor` is the
    /// `lastActiveAt` of the previous page's last row. Trigger runs are
    /// excluded (no `triggerId`), matching the desktop's "Chats" listing.
    static func conversations(
        token: String,
        teamId: String,
        cursor: String? = nil,
        limit: Int = 30,
        search: String? = nil
    ) async throws -> AgentConversationsPage {
        var query = [
            URLQueryItem(name: "teamId", value: teamId),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "scope", value: "mine"),
            URLQueryItem(name: "sort", value: "activity"),
            URLQueryItem(name: "archived", value: "exclude"),
        ]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let search, !search.isEmpty { query.append(URLQueryItem(name: "search", value: search)) }
        let observedAt = ProcessInfo.processInfo.systemUptime
        let page: AgentConversationsPage = try await get("agent/conversations", query: query, token: token, timeout: 20)
        for row in page.rows {
            RuntimeObservations.shared.receive(row.runtimeState, team: row.teamId ?? teamId, session: row.sessionId, observedAt: observedAt)
            ConversationUnread.shared.receive(team: row.teamId ?? teamId, session: row.sessionId, activity: row.activitySeq, read: row.readSeq, displayed: false)
        }
        return page
    }

    /// `GET /agent/conversations/:sessionId?teamId=&tail=` — the last `tail`
    /// messages of a conversation.
    static func conversationDetail(
        token: String, teamId: String, sessionId: String, tail: Int = 100, displayed: Bool = true
    ) async throws -> AgentConversationDetail {
        let detail: AgentConversationDetail = try await get(
            "agent/conversations/\(sessionId)",
            // `runtimeState=omit`: the server still probes the runtime when a run is
            // live, and otherwise answers with the state it last recorded, like the
            // list. Probing on every read made a slow computer hold each one for 3 s.
            query: [URLQueryItem(name: "teamId", value: teamId), URLQueryItem(name: "tail", value: String(tail)),
                    URLQueryItem(name: "runtimeState", value: "omit")],
            token: token,
            timeout: 20
        )
        ConversationUnread.shared.receive(team: teamId, session: sessionId, activity: detail.activitySeq, read: detail.readSeq, displayed: displayed)
        return detail
    }

    /// `GET /agent/credential-options?teamId=` — the IAM the agent may use.
    static func credentialOptions(token: String, teamId: String) async throws -> CredentialCatalog {
        let json: JSONValue = try await get("agent/credential-options", query: [URLQueryItem(name: "teamId", value: teamId)], token: token, timeout: 20)
        return CredentialCatalog(json: json["options"] ?? json)
    }

    /// `GET /teams/:id/agent-runtimes` — the runtimes a new chat can start on.
    static func runtimeInstances(token: String, teamId: String) async throws -> [RuntimeInstance] {
        /// A runtime this build can't decode (e.g. a newer provider) is skipped, not fatal to the list.
        struct Entry: Decodable {
            let runtime: RuntimeInstance?
            init(from decoder: Decoder) throws { runtime = try? RuntimeInstance(from: decoder) }
        }
        struct Envelope: Decodable { let runtimes: [Entry] }
        let envelope: Envelope = try await get("teams/\(teamId)/agent-runtimes", token: token, timeout: 20)
        return envelope.runtimes.compactMap(\.runtime)
    }

    static func runtimeQuotas(token: String, teamId: String) async throws -> [RuntimeQuota] {
        struct Entry: Decodable {
            let quota: RuntimeQuota?
            init(from decoder: Decoder) throws { quota = try? RuntimeQuota(from: decoder) }
        }
        struct Envelope: Decodable { let quotas: [Entry] }
        let envelope: Envelope = try await get("teams/\(teamId)/agent-runtimes/quota", token: token, timeout: 30)
        return envelope.quotas.compactMap(\.quota)
    }

    /// `GET /teams/:id/favorites` — pinned chats live here.
    static func sidebarFavorites(token: String, teamId: String) async throws -> SidebarFavorites {
        try await get("teams/\(teamId)/favorites", token: token, timeout: 20)
    }

    // MARK: - Transport

    private struct ErrorEnvelope: Decodable {
        struct Inner: Decodable { let message: String? }
        let error: Inner?
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoPlain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = iso.date(from: raw) ?? isoPlain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date: \(raw)"))
        }
        return d
    }()

    /// Whether the caller's conversation on a teammate's shared computer waits for its owner.
    static func ownShareApproval(token: String, sessionId: String) async throws -> ShareApprovalStatus {
        try await get(
            "agent/devices/share-approvals/mine",
            query: [URLQueryItem(name: "sessionId", value: sessionId)],
            token: token,
            timeout: 15
        )
    }

    private static func get<T: Decodable>(
        _ path: String, query: [URLQueryItem] = [], token: String, timeout: TimeInterval
    ) async throws -> T {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("nuphos-ios/\(appVersion)", forHTTPHeaderField: "x-atlas-client")
        request.setValue(AccountAPI.aiConsentVersion, forHTTPHeaderField: "x-nuphos-ai-consent-version")
        request.timeoutInterval = timeout

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw Failure.invalidResponse }

        switch http.statusCode {
        case 200..<300:
            do { return try decoder.decode(T.self, from: data) } catch { throw Failure.invalidResponse }
        case 401, 403:
            throw Failure.unauthorized
        default:
            let message = (try? decoder.decode(ErrorEnvelope.self, from: data))?.error?.message
            throw Failure.http(http.statusCode, message: message)
        }
    }

    private static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }
}
