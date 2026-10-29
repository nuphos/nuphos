import Foundation

/// One of the account's sign-ins, as `GET /auth/sessions` lists it.
struct SignInSession: Decodable, Identifiable, Equatable {
    let id: String
    let current: Bool?
    let createdAt: String?
    let lastUsedAt: String?
    let ip: String?
    let city: String?
    let country: String?
    /// The app's own name and version, e.g. `nuphos-ios/0.14.3`.
    let client: String?
    let userAgent: String?

    var isCurrent: Bool { current == true }
}

/// The labels Desktop's `signInSessionsPresentation.ts` shows.
enum SignInSessions {
    private static let apps = [
        "nuphos-desktop": "Nuphos Desktop",
        "nuphos-ios": "Nuphos for iOS",
        "nuphos-android": "Nuphos for Android",
        "nuphos-cli": "Nuphos CLI",
    ]
    private static let browsers = [("Edg/", "Edge"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari")]
    private static let systems = [("iPhone|iPad", "iOS"), ("Android", "Android"), ("Macintosh|Mac OS X", "macOS"), ("Windows", "Windows"), ("Linux", "Linux")]

    /// What signed in. The app name and user agent are whatever the signing-in
    /// client sent, so none of their text is shown, not even an app's version:
    /// a known app, a browser and system from a fixed list, or "Unknown device"
    /// (as the backend's emails do).
    static func device(_ session: SignInSession) -> String {
        if let name = apps[String((session.client ?? "").prefix { $0 != "/" })] { return name }
        let ua = session.userAgent ?? ""
        // The nuphos.ai web sign-in reaches the backend from the website's server.
        if session.client == nil, ua.range(of: #"^(node|undici)\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "Web sign-in (nuphos.ai)"
        }
        func first(_ list: [(String, String)]) -> String? {
            list.first { ua.range(of: $0.0, options: .regularExpression) != nil }?.1
        }
        switch (first(browsers), first(systems)) {
        case let (browser?, system?): return "\(browser) on \(system)"
        case let (browser?, nil): return browser
        case let (nil, system?): return "A browser on \(system)"
        case (nil, nil): return "Unknown device"
        }
    }

    /// `City, CC · IP`.
    static func place(_ session: SignInSession) -> String {
        let place = [session.city, session.country].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        return [place.isEmpty ? "Unknown location" : place, session.ip ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// This device first, then the most recently active.
    static func sorted(_ sessions: [SignInSession]) -> [SignInSession] {
        sessions.sorted {
            $0.isCurrent != $1.isCurrent ? $0.isCurrent : ($0.lastUsedAt ?? "") > ($1.lastUsedAt ?? "")
        }
    }

    /// "Active now" for this device, else "Last active 3 hours ago".
    static func activity(_ session: SignInSession, now: Date = .now) -> String {
        if session.isCurrent { return "Active now" }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let raw = session.lastUsedAt, let date = iso.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) else {
            return "Last active: unknown"
        }
        let relative = RelativeDateTimeFormatter()
        relative.locale = Locale(identifier: "en_US")
        return "Last active \(relative.localizedString(for: min(date, now), relativeTo: now))"
    }
}
