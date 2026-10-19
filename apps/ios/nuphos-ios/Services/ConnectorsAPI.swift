import Foundation

/// The connector half of api.nuphos.ai: the aggregated inventory, the
/// browser-based connect flows, and the token/credential binds. Every
/// mutating call here is `ADMINISTRATOR`-only on the backend.
enum ConnectorsAPI {
    /// `GET /teams/:id/connectors` — every bound connector in one round trip.
    static func inventory(token: String, teamId: String) async throws -> ConnectorInventory {
        let json: JSONValue = try await send("GET", "teams/\(teamId)/connectors", token: token, body: Empty?.none)
        return ConnectorInventory(json: json)
    }

    struct PendingOAuth: Sendable {
        let authorizeUrl: URL
        let state: String
    }

    /// `POST /teams/:id/<path>/start-oauth` — registers a pending grant and
    /// hands back the provider's authorize URL.
    static func startOAuth(token: String, teamId: String, path: String) async throws -> PendingOAuth {
        struct Response: Decodable { let authorizeUrl: String; let state: String }
        let response: Response = try await send("POST", "teams/\(teamId)/\(path)/start-oauth", token: token, body: Empty?.none)
        guard let url = URL(string: response.authorizeUrl) else { throw NuphosAPI.Failure.invalidResponse }
        return PendingOAuth(authorizeUrl: url, state: response.state)
    }

    /// Tears down a pending grant the user walked away from, so the authorize
    /// URL left open in the browser can't complete into a ghost binding.
    /// Idempotent, and best-effort by design — callers ignore failures.
    static func cancelOAuth(token: String, teamId: String, path: String, state: String) async {
        _ = try? await sendIgnoringResponse(
            "DELETE", "teams/\(teamId)/\(path)/start-oauth/\(state)", token: token, body: Empty?.none
        )
    }

    /// `POST /teams/:id/connector-oauth/:state/complete` — confirms a grant the
    /// backend staged (`deferred=1`) with the redirect's one-time code, so only
    /// the app that received the redirect can turn it into a binding.
    static func completeOAuth(token: String, teamId: String, state: String, code: String) async throws {
        struct Body: Encodable { let code: String }
        try await sendIgnoringResponse(
            "POST", "teams/\(teamId)/connector-oauth/\(state)/complete", token: token, body: Body(code: code)
        )
    }

    /// `GET /teams/:id/github-installations/install-url` — where to send the
    /// user to install the GitHub App.
    static func githubInstallURL(token: String, teamId: String) async throws -> URL {
        struct Response: Decodable { let url: String }
        let response: Response = try await send("GET", "teams/\(teamId)/github-installations/install-url", token: token, body: Empty?.none)
        guard let url = URL(string: response.url) else { throw NuphosAPI.Failure.invalidResponse }
        return url
    }

    /// Records the App installation GitHub just redirected back with.
    static func bindGithubInstallation(token: String, teamId: String, installationId: Int) async throws {
        struct Body: Encodable { let installationId: Int }
        try await sendIgnoringResponse(
            "POST", "teams/\(teamId)/github-installations", token: token, body: Body(installationId: installationId)
        )
    }

    /// `POST /teams/:id/<path>` with the filled fields. The backend schemas
    /// are `.strict()`, so the caller must omit blank optional fields rather
    /// than send them empty.
    static func bind(token: String, teamId: String, path: String, body: [String: String]) async throws {
        try await sendIgnoringResponse("POST", "teams/\(teamId)/\(path)", token: token, body: body)
    }

    // MARK: - Transport

    private struct Empty: Encodable {}

    private struct ErrorEnvelope: Decodable {
        struct Inner: Decodable { let message: String? }
        let error: Inner?
    }

    private static func send<B: Encodable, T: Decodable>(
        _ method: String, _ path: String, token: String, body: B?, timeout: TimeInterval = 30
    ) async throws -> T {
        let data = try await raw(method, path, token: token, body: body, timeout: timeout)
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw NuphosAPI.Failure.invalidResponse }
    }

    /// For the binds and teardowns whose response the app never reads — several
    /// of them answer 204, which no decoder can turn into a value.
    private static func sendIgnoringResponse<B: Encodable>(
        _ method: String, _ path: String, token: String, body: B?, timeout: TimeInterval = 30
    ) async throws {
        _ = try await raw(method, path, token: token, body: body, timeout: timeout)
    }

    private static func raw<B: Encodable>(
        _ method: String, _ path: String, token: String, body: B?, timeout: TimeInterval
    ) async throws -> Data {
        var request = URLRequest(url: NuphosAPI.baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(AgentChatAPI.clientVersion, forHTTPHeaderField: "x-atlas-client")
        request.setValue(AccountAPI.aiConsentVersion, forHTTPHeaderField: "x-nuphos-ai-consent-version")
        request.timeoutInterval = timeout
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw NuphosAPI.Failure.invalidResponse }

        switch http.statusCode {
        case 200..<300:
            return data
        case 401:
            throw NuphosAPI.Failure.unauthorized
        default:
            let message = (try? JSONDecoder().decode(ErrorEnvelope.self, from: data))?.error?.message
            throw NuphosAPI.Failure.http(http.statusCode, message: message)
        }
    }
}
