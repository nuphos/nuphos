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

        var errorDescription: String? {
            switch self {
            case .unauthorized: "Your session has expired. Please sign in again."
            case .sessionRequired: "Sign in again to manage your devices."
            case .http(let code, let message): message ?? "Nuphos returned an unexpected response (\(code))."
            case .invalidResponse: "Nuphos returned something we could not read."
            }
        }
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
