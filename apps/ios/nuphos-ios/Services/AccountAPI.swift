import Foundation

/// Account operations deliberately do not use the agent transport.
enum AccountAPI {
    /// Bump together with the displayed notice and backend AI_CONSENT_VERSION.
    static let aiConsentVersion = "2026-09-28"
    struct Consent: Codable { let version: String; let accepted: Bool }
    struct SignIn: Decodable { let token: String; let user: NuphosUser }
    struct OK: Decodable { let ok: Bool }

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
            let message = (json?["error"] as? [String: Any])?["message"] as? String
            throw NuphosAPI.Failure.http(response.statusCode, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
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
