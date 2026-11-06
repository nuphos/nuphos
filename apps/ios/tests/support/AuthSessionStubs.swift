import Foundation

// Stand-ins for what AuthSession calls, so its launch check can be driven
// without a network, a real Keychain or the Caches directory.

enum Keychain {
    nonisolated(unsafe) static var items: [String: String] = [:]
    static func load(_ key: String) throws -> String? { items[key] }
    static func read(_ key: String) -> String? { items[key] }
    static func write(_ value: String, for key: String) throws { items[key] = value }
    static func delete(_ key: String) { items[key] = nil }
}

enum NuphosAPI {
    @discardableResult static func rememberOrigin(_ origin: String, token: String) -> Bool { true }
    static func baseURL(for token: String?) -> URL { baseURL }
    static let baseURLKey = "test-api-base-url"
    static let baseURL = URL(string: "https://api.nuphos.ai")!

    nonisolated(unsafe) static var sharedSessionBaseURL: URL?
    enum Failure: LocalizedError {
        case unauthorized
        case http(Int, message: String?)
    }

    /// Answers `/auth/me` for a token; set by each test.
    nonisolated(unsafe) static var me: @MainActor (String) async throws -> NuphosUser = { _ in throw Failure.unauthorized }

    @MainActor static func currentUser(token: String) async throws -> NuphosUser { try await me(token) }
}

enum AccountAPI {
    static let aiConsentVersion = "2026-09-28"
    struct Consent: Codable { let version: String; let accepted: Bool }
    struct SignIn: Decodable { let token: String; let user: NuphosUser }

    /// The token the email sign-in hands out.
    nonisolated(unsafe) static var signInToken = ""

    nonisolated(unsafe) static var consentReply: ((String) async throws -> Consent)?

    static func request<T: Decodable>(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil, upload: Data? = nil) async throws -> T {
        if path == "ai-consent", let consentReply { return try await consentReply(token ?? "") as! T }
        let json: Any = path == "ai-consent"
            ? ["version": aiConsentVersion, "accepted": true]
            : ["token": signInToken, "user": ["id": "u-\(signInToken)"]]
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: json))
    }

    static func endSession(token: String) async {}
}

enum LaunchCache {
    struct User: Codable {
        let user: NuphosUser
        let aiConsentVersion: String
    }

    nonisolated(unsafe) static var user: User?
    static func read(_ type: User.Type) -> User? { user }
    static func write(_ value: User) { user = value }
    static func clear() { user = nil }
}

final class Analytics {
    static let shared = Analytics()
    func identify(_ user: NuphosUser) {}
    func reset() {}
    func track(_ event: String, teamID: String? = nil, properties: [String: Any] = [:]) {}
}

final class PushNotifications {
    static let shared = PushNotifications()
    var routingEnabled = true
    var activation: ((String) async -> Void)?
    func deactivate() async { routingEnabled = false }
    func invalidateRouting() { routingEnabled = false }
    func activate(authToken: String) async {
        routingEnabled = true
        await activation?(authToken)
    }
}

enum ComposerDrafts {
    static func clear() {}
}

enum NuphosWeb {
    enum Provider { case apple, google }
    enum CallbackResult { case code(String), failure(String) }
    static let callbackScheme = "nuphos"
    static func randomSecret() throws -> String { "secret" }
    static func challenge(_ verifier: String) -> String { verifier }
    static func loginURL(baseURL: URL, handle: String, provider: Provider) -> URL { baseURL.appending(path: "auth/social/login") }
    static func parseCallback(_ url: URL, expectedState: String) -> CallbackResult? { nil }
}

// Observe publication order here; storage CAS is exercised separately against Security.framework.
enum SharedShareSession {
    struct Record { let token: String; let accountID: String; let backend: URL }
    enum Failure: Error { case identity, unavailable }
    nonisolated(unsafe) static var publishedToken: String?
    static func validate(_ record: Record) throws {}
    static func publishLogin(token: String, accountID: String, backend: URL) throws -> UUID { publishedToken = token; return UUID() }
    static func revoke() { publishedToken = nil }
}
