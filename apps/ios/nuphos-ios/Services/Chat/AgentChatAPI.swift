import Foundation

/// The chat-side endpoints of api.nuphos.ai — request builders and small
/// JSON calls. Streaming itself lives in `ChatSession` on top of `SSEClient`.
enum AgentChatAPI {
    static var baseURL: URL { NuphosAPI.baseURL }

    struct ChatRequest: Encodable {
        var id: String
        var teamId: String
        var messages: [ChatMessage]
        var baseIndex: Int?
        var streamId: String
        var resume: Bool?
        var resumeFrom: Int?
        var continueAfterInterruption: Bool?
        var resumeReason: String?
        var permissionMode: String?
        var credentialAccess: JSONValue?
        var agentRuntime: String?
        var runtimeId: String?
        var clientCapabilities: [String: Bool]?
    }

    /// The `POST /agent/chat` request. `accept-encoding: identity` is
    /// load-bearing: a compressed SSE body gets buffered.
    static func chatRequest(token: String, body: ChatRequest) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: "agent/chat"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "accept")
        request.setValue("identity", forHTTPHeaderField: "accept-encoding")
        request.setValue(clientVersion, forHTTPHeaderField: "x-atlas-client")
        request.setValue(AccountAPI.aiConsentVersion, forHTTPHeaderField: "x-nuphos-ai-consent-version")
        request.setValue(Locale.current.identifier.replacingOccurrences(of: "_", with: "-"), forHTTPHeaderField: "x-atlas-locale")
        request.setValue("/teams/\(body.teamId)/agent/\(body.id)", forHTTPHeaderField: "x-atlas-url")
        // URLSession's idle timeout between packets, not a deadline for the
        // turn: it covers a stalled upload, and heartbeats keep a live stream
        // well inside it.
        request.timeoutInterval = 60
        let data = try encoder.encode(body)
        try ChatPayload.check(data)
        request.httpBody = data
        return request
    }

    /// `POST /agent/chat/:streamId/abort`. `local` only means the runtime
    /// was told to stop; the turn ends when its terminal frames arrive.
    enum AbortStatus: String { case local, forwarded, notFound = "not_found", failed }

    static func abort(token: String, streamId: String) async -> AbortStatus {
        var request = URLRequest(url: baseURL.appending(path: "agent/chat/\(streamId)/abort"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.timeoutInterval = 10
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse else { return .failed }
        if http.statusCode == 404 { return .notFound }
        guard (200..<300).contains(http.statusCode),
              let json = try? JSONDecoder().decode(JSONValue.self, from: data) else { return .failed }
        return AbortStatus(rawValue: json["status"]?.stringValue ?? "") ?? .local
    }

    /// Why a transcript PUT was accepted without being stored.
    enum TranscriptSkip: String { case serverAuthoritative = "server_authoritative", slackBound = "slack_bound" }

    /// `PUT /agent/conversations/:id/transcript` — delete-absent sync.
    /// Throws `Conflict.transcriptOutOfSync(storedMessageCount:)` on 409.
    /// Returns the skip reason when the server owns this transcript.
    @discardableResult
    static func putTranscript(
        token: String, teamId: String, sessionId: String,
        title: String, messages: [ChatMessage], baseIndex: Int?,
        agentRuntime: String? = nil, runtimeId: String? = nil
    ) async throws -> TranscriptSkip? {
        struct Body: Encodable {
            var title: String
            var messages: [ChatMessage]
            var baseIndex: Int?
            var teamId: String
            var agentRuntime: String?
            var runtimeId: String?
        }
        let body = Body(
            title: title, messages: messages, baseIndex: (baseIndex ?? 0) > 0 ? baseIndex : nil, teamId: teamId,
            agentRuntime: agentRuntime, runtimeId: runtimeId
        )
        let data = try await send(
            "PUT", "agent/conversations/\(sessionId)/transcript",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: body
        )
        let json = try? JSONDecoder().decode(JSONValue.self, from: data)
        return json?["skipped"]?.stringValue.flatMap(TranscriptSkip.init)
    }

    struct PushDevice: Encodable {
        var token: String
        var deviceId: String
        var environment: String
        var bundleId: String
        var platform = "ios"
    }

    /// `PUT /push/devices` — idempotent per (user, device).
    static func registerPushDevice(token: String, device: PushDevice) async throws {
        try await send("PUT", "push/devices", token: token, body: device, timeout: 15)
    }

    /// `DELETE /push/devices/:token`.
    static func unregisterPushDevice(token: String, deviceToken: String) async throws {
        try await send("DELETE", "push/devices/\(deviceToken)", token: token, body: Optional<Int>.none, timeout: 10)
    }

    /// `PATCH /agent/conversations/:id/archive`.
    static func setArchived(token: String, teamId: String, sessionId: String, archived: Bool) async throws {
        struct Body: Encodable { var archived: Bool; var teamId: String }
        _ = try await send(
            "PATCH", "agent/conversations/\(sessionId)/archive",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Body(archived: archived, teamId: teamId)
        )
    }

    /// `POST /agent/conversations/:id/read` — the server keeps the larger marker.
    static func markRead(token: String, teamId: String, sessionId: String, seq: Int) async throws -> ConversationUnread.Marker {
        struct Body: Encodable { var seq: Int }
        struct State: Decodable { let activitySeq: Int; let readSeq: Int }
        let data = try await send("POST", "agent/conversations/\(sessionId)/read",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Body(seq: seq))
        let state = try JSONDecoder().decode(State.self, from: data)
        return ConversationUnread.Marker(activity: state.activitySeq, read: state.readSeq)
    }

    /// `POST /agent/conversations/:id/steer` — hands a message to the turn
    /// already running, without opening a second stream.
    static func steer(token: String, teamId: String, sessionId: String, text: String) async throws -> String {
        struct Body: Encodable { var text: String }
        struct Receipt: Decodable { let messageId: String }
        let data = try await send("POST", "agent/conversations/\(sessionId)/steer",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Body(text: text))
        return try JSONDecoder().decode(Receipt.self, from: data).messageId
    }

    static func cancelRuntime(token: String, teamId: String, sessionId: String) async throws {
        _ = try await send("POST", "agent/conversations/\(sessionId)/cancel-runtime",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Optional<Int>.none)
    }

    /// `GET /agent/conversations/:id/model-config`.
    static func sessionConfig(token: String, teamId: String, sessionId: String) async throws -> SessionConfigState {
        let data = try await send(
            "GET", "agent/conversations/\(sessionId)/model-config",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Optional<Int>.none, timeout: 20
        )
        return try JSONDecoder().decode(SessionConfigState.self, from: data)
    }

    /// `PATCH /agent/conversations/:id/model-config` — 409 `runtime_busy`
    /// while a reply runs.
    static func setSessionConfig(token: String, teamId: String, sessionId: String, configId: String, value: String) async throws -> SessionConfigState {
        struct Body: Encodable { var configId: String; var value: String }
        let data = try await send(
            "PATCH", "agent/conversations/\(sessionId)/model-config",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Body(configId: configId, value: value), timeout: 20
        )
        return try JSONDecoder().decode(SessionConfigState.self, from: data)
    }

    /// `PUT /teams/:id/favorites` — replaces the whole list; 409
    /// `sidebar_favorites_changed` when `expectedRevision` is stale.
    static func putSidebarFavorites(token: String, teamId: String, entries: [SidebarFavorites.Entry], expectedRevision: Int) async throws -> SidebarFavorites {
        struct Body: Encodable { var expectedRevision: Int; var entries: [SidebarFavorites.Entry] }
        let data = try await send("PUT", "teams/\(teamId)/favorites", token: token, body: Body(expectedRevision: expectedRevision, entries: entries))
        return try JSONDecoder().decode(SidebarFavorites.self, from: data)
    }

    /// `POST …/messages/:id/feedback`.
    static func feedback(token: String, teamId: String, sessionId: String, messageId: String, rating: String?, comment: String? = nil) async throws {
        struct Body: Encodable { var rating: String?; var comment: String?; var teamId: String }
        _ = try await send(
            "POST", "agent/conversations/\(sessionId)/messages/\(messageId)/feedback",
            query: [URLQueryItem(name: "teamId", value: teamId)], token: token,
            body: Body(rating: rating, comment: comment, teamId: teamId), encodeNulls: true
        )
    }

    // MARK: Auto Mode

    /// `POST /agent/auto-mode/session-approvals` — "Approve for session".
    static func approveForSession(token: String, sessionId: String, command: String) async throws {
        struct Body: Encodable { var sessionId: String; var command: String }
        _ = try await send("POST", "agent/auto-mode/session-approvals", token: token, body: Body(sessionId: sessionId, command: command))
    }

    /// `POST /agent/auto-mode/policy/rules` — "Always allow…".
    static func createPolicyRule(token: String, description: String) async throws {
        struct Body: Encodable { var description: String }
        _ = try await send("POST", "agent/auto-mode/policy/rules", token: token, body: Body(description: String(description.prefix(200))))
    }

    static func activatePolicyRule(token: String, ruleId: String) async throws {
        _ = try await send("POST", "agent/auto-mode/policy/rules/\(ruleId)/activate", token: token, body: Optional<Int>.none)
    }

    static func deletePolicyRule(token: String, ruleId: String) async throws {
        _ = try await send("DELETE", "agent/auto-mode/policy/rules/\(ruleId)", token: token, body: Optional<Int>.none)
    }

    /// `GET /agent/auto-mode/bypass?sessionId=` → whether this conversation
    /// runs every command without asking.
    static func bypass(token: String, sessionId: String) async throws -> Bool {
        let data = try await send("GET", "agent/auto-mode/bypass", query: [URLQueryItem(name: "sessionId", value: sessionId)], token: token, body: Optional<Int>.none)
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        return json["bypass"]?.boolValue ?? false
    }

    /// `PUT /agent/auto-mode/bypass` — the only way to change the mode after
    /// the first message.
    static func setBypass(token: String, sessionId: String, bypass: Bool) async throws {
        struct Body: Encodable { var sessionId: String; var bypass: Bool }
        _ = try await send("PUT", "agent/auto-mode/bypass", token: token, body: Body(sessionId: sessionId, bypass: bypass))
    }

    // MARK: Plans

    static func plan(token: String, teamId: String, planId: String) async throws -> Plan {
        let data = try await send("GET", "agent/plans/\(planId)", query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Optional<Int>.none)
        return try decodePlan(data)
    }

    static func updatePlan(token: String, teamId: String, planId: String, status: String) async throws -> Plan {
        struct Body: Encodable { var status: String; var teamId: String }
        let data = try await send(
            "PATCH", "agent/plans/\(planId)", query: [URLQueryItem(name: "teamId", value: teamId)],
            token: token, body: Body(status: status, teamId: teamId)
        )
        return try decodePlan(data)
    }

    /// `GET /agent/plans?teamId=&limit=&cursor=` — newest first; `cursor` is
    /// the `createdAt` of the previous page's last row.
    static func listPlans(token: String, teamId: String, limit: Int = 50, cursor: String? = nil) async throws -> PlanListPage {
        var query = [URLQueryItem(name: "teamId", value: teamId), URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        let data = try await send("GET", "agent/plans", query: query, token: token, body: Optional<Int>.none)
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        return PlanListPage(
            plans: (json["plans"]?.arrayValue ?? []).compactMap(Plan.init(json:)),
            nextCursor: json["nextCursor"]?.stringValue,
            hasMore: json["hasMore"]?.boolValue ?? false
        )
    }

    /// `GET /agent/plan-approval-policy?teamId=` — what new plans snapshot.
    static func planApprovalPolicy(token: String, teamId: String) async throws -> PlanApprovalRequirement {
        let data = try await send("GET", "agent/plan-approval-policy", query: [URLQueryItem(name: "teamId", value: teamId)], token: token, body: Optional<Int>.none)
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        return PlanApprovalRequirement(json: json)
    }

    /// `PUT /agent/plan-approval-policy` — administrators only. Approvals on
    /// open plans are invalidated server-side.
    static func updatePlanApprovalPolicy(token: String, teamId: String, minimumOtherApprovals: Int) async throws -> PlanApprovalRequirement {
        struct Body: Encodable { var teamId: String; var requesterApprovalRequired: Bool; var minimumOtherApprovals: Int }
        let data = try await send(
            "PUT", "agent/plan-approval-policy", token: token,
            body: Body(teamId: teamId, requesterApprovalRequired: true, minimumOtherApprovals: minimumOtherApprovals)
        )
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        return PlanApprovalRequirement(json: json)
    }

    private static func decodePlan(_ data: Data) throws -> Plan {
        let json = try JSONDecoder().decode(JSONValue.self, from: data)
        // Either the plan itself or `{ plan: … }`.
        let node = json["plan"] ?? json
        guard let plan = Plan(json: node) else { throw NuphosAPI.Failure.invalidResponse }
        return plan
    }

    // MARK: Transport

    enum Conflict: LocalizedError {
        case transcriptOutOfSync(storedMessageCount: Int?)
        case streamNotResumable
        case streamConflict
        case conversationBusy
        case runtimeNotReady
        case runtimeLoginRequired
        case runtimeDisabled
        case runtimeNotFound
        case runtimeOffline
        case runtimeUnavailable(String)
        case runtimeBusy
        case conversationNotRunning
        case conversationInUseByTeammate
        case favoritesChanged
        case other(code: String?, message: String, status: Int)

        var errorDescription: String? {
            switch self {
            case .transcriptOutOfSync: "The conversation changed elsewhere; resyncing."
            case .streamNotResumable: "The previous reply can no longer be resumed."
            case .streamConflict: "That stream belongs to another conversation."
            case .conversationBusy: "This conversation is busy with another reply."
            case .runtimeNotReady: "The agent is not ready for a new message yet. Try again in a moment."
            case .runtimeLoginRequired: "This agent is not signed in. Sign in to it on the computer running it, or ask an administrator to sign in a Cloud agent from the desktop app's Settings → Agent."
            case .runtimeDisabled: "This conversation's agent is disabled. Start a new chat on another agent."
            case .runtimeNotFound: "This agent is no longer available in this workspace. Start a new chat on another agent."
            case .runtimeOffline: "The computer running this agent is offline. Open Nuphos on it with the local agent turned on, or start a new chat on a Cloud agent."
            case .runtimeUnavailable(let message): message
            case .runtimeBusy: "Wait for the current reply to finish before changing model settings."
            case .conversationNotRunning: "This conversation is no longer running."
            case .conversationInUseByTeammate: "A teammate is using this conversation right now. Try again after their turn finishes."
            case .favoritesChanged: "Pinned chats changed elsewhere; refreshing."
            case .other(_, let message, _): message
            }
        }
    }

    /// Parses an Atlas error body into a typed conflict.
    static func conflict(status: Int, body: String?) -> Conflict {
        if status == 413 { return .other(code: "payload_too_large", message: ChatPayload.tooLargeMessage, status: status) }
        var code: String?
        var message = body ?? "Nuphos returned status \(status)."
        var stored: Int?
        if let body, let data = body.data(using: .utf8),
           let json = try? JSONDecoder().decode(JSONValue.self, from: data) {
            let error = json["error"] ?? json
            code = error["code"]?.stringValue
            message = error["message"]?.stringValue ?? message
            stored = error["details"]?["storedMessageCount"]?.numberValue.map(Int.init)
        }
        switch code {
        case "transcript_out_of_sync": return .transcriptOutOfSync(storedMessageCount: stored)
        case "stream_not_resumable": return .streamNotResumable
        case "stream_conflict": return .streamConflict
        case "conversation_busy": return .conversationBusy
        case "runtime_not_accepting_message": return .runtimeNotReady
        case "runtime_login_required": return .runtimeLoginRequired
        case "runtime_disabled": return .runtimeDisabled
        case "runtime_not_found": return .runtimeNotFound
        case "runtime_offline": return .runtimeOffline
        case "runtime_unavailable": return .runtimeUnavailable(message)
        case "runtime_busy": return .runtimeBusy
        case "conversation_not_running": return .conversationNotRunning
        case "conversation_in_use_by_teammate": return .conversationInUseByTeammate
        case "sidebar_favorites_changed": return .favoritesChanged
        default: return .other(code: code, message: message, status: status)
        }
    }

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.withoutEscapingSlashes]
        return e
    }()

    static var clientVersion: String {
        "nuphos-ios/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0")"
    }

    @discardableResult
    static func send<B: Encodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], token: String, body: B?, encodeNulls: Bool = false,
        timeout: TimeInterval = 30
    ) async throws -> Data {
        var components = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.setValue("application/json", forHTTPHeaderField: "accept")
        request.setValue(clientVersion, forHTTPHeaderField: "x-atlas-client")
        request.setValue(AccountAPI.aiConsentVersion, forHTTPHeaderField: "x-nuphos-ai-consent-version")
        request.timeoutInterval = timeout
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            let data = try encoder.encode(body)
            if path.hasSuffix("/transcript") { try ChatPayload.check(data) }
            request.httpBody = data
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw NuphosAPI.Failure.invalidResponse }
        switch http.statusCode {
        case 200..<300: return data
        case 401: throw NuphosAPI.Failure.unauthorized
        default: throw conflict(status: http.statusCode, body: String(data: data, encoding: .utf8))
        }
    }
}

/// `Plan` DTO (`api/plan-types.ts` on the desktop) — the fields the card,
/// the library list and the detail page render. Everything else is ignored.
struct Plan: Identifiable, Equatable, Hashable, Sendable {
    struct Command: Equatable, Hashable, Sendable {
        var command: String
        var description: String?
        var status: String?
        var stdout: String?
        var stderr: String?
        var exitCode: Int?
    }
    struct Job: Equatable, Hashable, Sendable {
        var title: String
        var description: String?
        var commands: [Command]
    }
    struct Step: Equatable, Hashable, Sendable {
        var title: String
        var description: String?
        var jobs: [Job]

        var commands: [Command] { jobs.flatMap(\.commands) }

        /// The desktop's `rollupPlanStatus`: failed > done > running >
        /// partial > pending; nil when the step has no commands.
        var rollupStatus: String? {
            let statuses = commands.map { $0.status ?? "pending" }
            guard !statuses.isEmpty else { return nil }
            if statuses.contains("failed") { return "failed" }
            if statuses.allSatisfy({ $0 == "done" }) { return "done" }
            if statuses.contains("running") { return "running" }
            if statuses.contains("done") { return "partial" }
            return "pending"
        }
    }
    struct Decision: Equatable, Hashable, Sendable {
        var label: String
        var value: String
    }
    struct ApprovalProgress: Equatable, Hashable, Sendable {
        var requesterApproved: Bool
        var requesterApprovalRequired: Bool
        var otherApprovals: Int
        var minimumOtherApprovals: Int
        var satisfied: Bool

        /// Approvals still missing before the gate opens.
        var remaining: Int {
            max(0, (requesterApprovalRequired && !requesterApproved ? 1 : 0) + minimumOtherApprovals - otherApprovals)
        }
    }
    struct Progress: Equatable, Hashable, Sendable {
        var done: Int
        var failed: Int
        var total: Int
        var fraction: Double { total == 0 ? 0 : Double(done) / Double(total) }
    }

    var id: String
    var teamId: String?
    var number: Int?
    var title: String
    var overview: String
    var status: String
    var steps: [Step]
    var decisions: [Decision]
    var costSummary: String?
    var costOneTime: String?
    var costMonthly: String?
    var costSavings: String?
    var riskWorstCase: String?
    var riskMitigations: [String]
    var approvalProgress: ApprovalProgress?
    var approvalCount: Int
    var executionError: String?
    var createdBy: String
    var createdAt: Date?
    var updatedAt: Date?
    /// The conversation the plan was proposed in — resume it to continue.
    var sourceConversationId: String?
    /// Legacy snapshots have no typed actions; database-change plans do.
    var hasActions: Bool

    static let lifecycleStatuses = ["proposed", "approved", "executing", "completed", "failed", "rejected", "cancelled"]

    var isActive: Bool { ["proposed", "approved", "executing"].contains(status) }
    /// The desktop's `CANCELLABLE_STATUSES` — can still be marked unplanned.
    var isCancellable: Bool { isActive }
    /// The desktop's `DISMISSED_STATUSES` — hidden from the library by default.
    var isDismissed: Bool { status == "rejected" || status == "cancelled" }

    /// `isPlanReadyForApproval`: steps with jobs, a cost and a risk section.
    var isReadyForApproval: Bool {
        func hasText(_ s: String?) -> Bool { !(s ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return !steps.isEmpty && steps.allSatisfy { !$0.jobs.isEmpty }
            && hasText(costSummary) && hasText(riskWorstCase) && riskMitigations.contains(where: hasText)
    }

    var displayNumber: String { number.map { "#\($0)" } ?? "#\(id)" }

    /// The desktop's `stepProgress`: a step with no commands counts as pending.
    var progress: Progress {
        let statuses = steps.map { $0.rollupStatus ?? "pending" }
        return Progress(done: statuses.filter { $0 == "done" }.count, failed: statuses.filter { $0 == "failed" }.count, total: statuses.count)
    }

    var totalJobs: Int { steps.reduce(0) { $0 + $1.jobs.count } }
    var totalCommands: Int { steps.reduce(0) { $0 + $1.commands.count } }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()

    static func date(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        return iso.date(from: raw) ?? isoPlain.date(from: raw)
    }

    init?(json: JSONValue) {
        guard let id = json["id"]?.stringValue ?? json["id"]?.numberValue.map({ String(Int($0)) }) else { return nil }
        self.id = id
        teamId = json["teamId"]?.stringValue
        number = json["number"]?.numberValue.map(Int.init)
        title = json["title"]?.stringValue ?? "Plan"
        overview = json["overview"]?.stringValue ?? ""
        status = json["status"]?.stringValue ?? "proposed"
        decisions = (json["decisions"]?.arrayValue ?? []).compactMap { d in
            if let s = d.stringValue { return Decision(label: "", value: s) }
            guard let value = d["value"]?.stringValue else { return nil }
            return Decision(label: d["label"]?.stringValue ?? "", value: value)
        }
        costSummary = json["costSummary"]?.stringValue
        costOneTime = json["costOneTime"]?.stringValue
        costMonthly = json["costMonthly"]?.stringValue
        costSavings = json["costSavings"]?.stringValue
        riskWorstCase = json["riskWorstCase"]?.stringValue
        riskMitigations = json["riskMitigations"]?.arrayValue?.compactMap(\.stringValue) ?? []
        executionError = json["executionError"]?.stringValue
        createdBy = json["createdBy"]?.stringValue ?? ""
        createdAt = Self.date(json["createdAt"]?.stringValue)
        updatedAt = Self.date(json["updatedAt"]?.stringValue)
        sourceConversationId = json["sourceConversationId"]?.stringValue
        hasActions = !(json["actions"]?.arrayValue ?? []).isEmpty
        approvalCount = json["approvals"]?.arrayValue?.count ?? 0
        steps = (json["steps"]?.arrayValue ?? []).map { s in
            Step(
                title: s["title"]?.stringValue ?? "",
                description: s["description"]?.stringValue,
                jobs: (s["jobs"]?.arrayValue ?? []).map { j in
                    Job(
                        title: j["title"]?.stringValue ?? "",
                        description: j["description"]?.stringValue,
                        commands: (j["commands"]?.arrayValue ?? []).map { c in
                            Command(
                                command: c["command"]?.stringValue ?? "",
                                description: c["description"]?.stringValue,
                                status: c["status"]?.stringValue,
                                stdout: c["stdout"]?.stringValue,
                                stderr: c["stderr"]?.stringValue,
                                exitCode: c["exitCode"]?.numberValue.map(Int.init)
                            )
                        }
                    )
                }
            )
        }
        if let ap = json["approvalProgress"] {
            let requesterApproved: Bool = ap["requesterApproved"]?.boolValue ?? false
            let requesterApprovalRequired: Bool = ap["requesterApprovalRequired"]?.boolValue ?? false
            let otherApprovals: Int = ap["otherApprovals"]?.numberValue.map(Int.init) ?? 0
            let minimumOtherApprovals: Int = ap["minimumOtherApprovals"]?.numberValue.map(Int.init) ?? 0
            let satisfied: Bool = ap["satisfied"]?.boolValue ?? false
            approvalProgress = ApprovalProgress(
                requesterApproved: requesterApproved,
                requesterApprovalRequired: requesterApprovalRequired,
                otherApprovals: otherApprovals,
                minimumOtherApprovals: minimumOtherApprovals,
                satisfied: satisfied
            )
        }
    }
}

/// One page of `GET /agent/plans`.
struct PlanListPage: Sendable {
    var plans: [Plan]
    var nextCursor: String?
    var hasMore: Bool
}

/// `PlanApprovalRequirement` — the team policy new plans snapshot.
struct PlanApprovalRequirement: Equatable, Sendable {
    var requesterApprovalRequired: Bool
    var minimumOtherApprovals: Int

    init(requesterApprovalRequired: Bool = true, minimumOtherApprovals: Int = 0) {
        self.requesterApprovalRequired = requesterApprovalRequired
        self.minimumOtherApprovals = minimumOtherApprovals
    }

    init(json: JSONValue) {
        requesterApprovalRequired = json["requesterApprovalRequired"]?.boolValue ?? true
        minimumOtherApprovals = json["minimumOtherApprovals"]?.numberValue.map(Int.init) ?? 0
    }

    /// The desktop's policy strip copy.
    var summary: String {
        minimumOtherApprovals == 0
            ? "Requester only"
            : "Requester + \(minimumOtherApprovals) other member\(minimumOtherApprovals == 1 ? "" : "s")"
    }
}
