import Foundation

/// Account operations deliberately do not use the agent transport.
enum AccountAPI {
    /// Bump together with the displayed notice and backend AI_CONSENT_VERSION.
    static let aiConsentVersion = "2026-09-28"
    struct Consent: Codable { let version: String; let accepted: Bool }
    struct SignIn: Decodable { let token: String; let user: NuphosUser }
    struct OK: Decodable { let ok: Bool }
    /// For a 204 reply.
    struct Empty: Decodable {}

    static func request<T: Decodable>(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil) async throws -> T {
        var request = URLRequest(url: NuphosAPI.baseURL.appending(path: "auth/\(path)"))
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("nuphos-ios/\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown")", forHTTPHeaderField: "x-atlas-client")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw NuphosAPI.Failure.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let error = json?["error"] as? [String: Any]
            // A sign-in from before sessions. Unlike `unauthorized`, it never signs out.
            if error?["code"] as? String == "session_required" { throw NuphosAPI.Failure.sessionRequired }
            throw NuphosAPI.Failure.http(response.statusCode, message: error?["message"] as? String)
        }
        return try JSONDecoder().decode(T.self, from: data.isEmpty ? Data("{}".utf8) : data)
    }

    /// `GET /auth/sessions`: the account's sign-ins.
    static func signInSessions(token: String) async throws -> [SignInSession] {
        struct Envelope: Decodable { let sessions: [SignInSession] }
        let envelope: Envelope = try await request("sessions", token: token)
        return envelope.sessions
    }

    static func signOutSession(id: String, token: String) async throws {
        let _: Empty = try await request("sessions/\(id)", method: "DELETE", token: token)
    }

    /// Signs out every device but this one; returns how many.
    static func signOutOtherSessions(token: String) async throws -> Int {
        struct Revoked: Decodable { let revoked: Int }
        let result: Revoked = try await request("sessions", method: "DELETE", token: token)
        return result.revoked
    }

    /// Ends this device's session on the server. Best effort: sign-out never waits on it.
    static func endSession(token: String) async {
        var request = URLRequest(url: NuphosAPI.baseURL.appending(path: "auth/sessions/current"))
        request.httpMethod = "DELETE"
        request.timeoutInterval = 10
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        _ = try? await URLSession.shared.data(for: request)
    }
}
