import Foundation

/// The backend this app talks to. Kept apart from the calls in
/// `NuphosAPI.swift` so code that only needs the origin builds without them.
enum NuphosAPI {
    enum Failure: LocalizedError {
        case unauthorized
        /// `403 session_required`: this sign-in predates sessions.
        case sessionRequired
        case http(Int, message: String?)
        case invalidResponse
        /// The account has two-factor authentication on: the sign-in continues
        /// with this challenge and a code (`POST /auth/mfa/verify`).
        case mfaRequired(token: String)
        /// `403 reauth_required`: the action needs a code entered in the last
        /// few minutes (`StepUp.swift`).
        case reauthRequired
        /// `403 reauth_required` for an account without it: only a fresh sign-in will do.
        case signInRequired

        var errorDescription: String? {
            switch self {
            case .unauthorized: "Your session has expired. Please sign in again."
            case .sessionRequired: "Sign in again to manage your devices."
            case .http(let code, let message): message ?? "Nuphos returned an unexpected response (\(code))."
            case .invalidResponse: "Nuphos returned something we could not read."
            case .mfaRequired: "Enter the code from your authenticator app."
            case .reauthRequired: "Enter a code from your authenticator app to continue."
            case .signInRequired: "For your security, sign in again to continue."
            }
        }
    }

    /// The backend's own error code, e.g. `reauth_required`, from `{ error: { code } }`.
    static func errorCode(_ data: Data) -> (code: String?, details: [String: Any]?) {
        let error = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any]
        return (error?["code"] as? String, error?["details"] as? [String: Any])
    }

    /// A 403 that a code from the authenticator app would clear (`StepUp.swift`).
    static func needsStepUp(_ data: Data) -> Bool {
        let (code, details) = errorCode(data)
        return code == "reauth_required" && details?["method"] as? String == "mfa"
    }

    private static let originsLock = NSLock()
    nonisolated(unsafe) private static var tokenOrigins: [String: URL] = [:]

    @discardableResult
    static func rememberOrigin(_ origin: String, token: String) -> Bool {
        guard let url = URL(string: origin) else { return false }
        return originsLock.withLock {
            if let existing = tokenOrigins[token], existing != url { return false }
            tokenOrigins[token] = url
            return true
        }
    }

    static func baseURL(for token: String?) -> URL {
        guard let token else { return baseURL }
        return originsLock.withLock { tokenOrigins[token] } ?? baseURL
    }

    static let defaultBaseURL = URL(string: "https://api.nuphos.ai")!
    /// UserDefaults key for a self-hosted backend origin; unset means Nuphos Cloud.
    static let baseURLKey = "apiBaseURL"

    static var sharedSessionBaseURL: URL?

    static var baseURL: URL {
        if let sharedSessionBaseURL { return sharedSessionBaseURL }
        return UserDefaults.standard.string(forKey: baseURLKey).flatMap(URL.init(string:)) ?? defaultBaseURL
    }
}
