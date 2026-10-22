import Foundation

/// The backend this app talks to. Kept apart from the calls in
/// `NuphosAPI.swift` so code that only needs the origin builds without them.
enum NuphosAPI {
    static let defaultBaseURL = URL(string: "https://api.nuphos.ai")!
    /// UserDefaults key for a self-hosted backend origin; unset means Nuphos Cloud.
    static let baseURLKey = "apiBaseURL"

    static var baseURL: URL {
        UserDefaults.standard.string(forKey: baseURLKey).flatMap(URL.init(string:)) ?? defaultBaseURL
    }
}
