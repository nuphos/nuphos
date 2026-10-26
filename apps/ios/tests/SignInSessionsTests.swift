import Foundation

enum SignInSessionsTests {
    static func run() {
        namesKnownApps()
        neverShowsClientOrUserAgentText()
        guessesBrowsersAndSystems()
        labelsPlaces()
        sortsThisDeviceFirstThenMostRecent()
        describesActivity()
        decodesNullFields()
        print("Sign-in sessions passed")
    }

    private static func session(
        _ id: String = "s", current: Bool? = false, lastUsedAt: String? = nil,
        ip: String? = nil, city: String? = nil, country: String? = nil,
        client: String? = nil, userAgent: String? = nil
    ) -> SignInSession {
        SignInSession(id: id, current: current, createdAt: nil, lastUsedAt: lastUsedAt, ip: ip, city: city, country: country, client: client, userAgent: userAgent)
    }

    private static func device(client: String? = nil, userAgent: String? = nil) -> String {
        SignInSessions.device(session(client: client, userAgent: userAgent))
    }

    private static func expect(_ got: String, _ want: String, _ what: String) {
        precondition(got == want, "\(what): expected \(want), got \(got)")
    }

    private static func namesKnownApps() {
        expect(device(client: "nuphos-desktop/0.95.0"), "Nuphos Desktop", "desktop")
        expect(device(client: "nuphos-ios/0.14.3"), "Nuphos for iOS", "ios")
        expect(device(client: "nuphos-android/1.4.0"), "Nuphos for Android", "android")
        expect(device(client: "nuphos-cli/0.3.1", userAgent: "curl/8"), "Nuphos CLI", "cli")
        expect(device(client: "nuphos-ios"), "Nuphos for iOS", "no version")
    }

    private static func neverShowsClientOrUserAgentText() {
        // The version is the client's claim, so none of it is shown.
        expect(device(client: "nuphos-desktop/1.verify-at.evil-phish.com"), "Nuphos Desktop", "phish version")
        expect(device(client: "nuphos-ios/1.0\nVisit evil.example"), "Nuphos for iOS", "newline version")
        let unknown = ["nuphos-tv/1.0", "Nuphos-ios/1.0", "nuphos-ios 1.0", "/nuphos-ios", "evil.example/nuphos-ios", ""]
        for client in unknown {
            expect(device(client: client), "Unknown device", "client \(client.debugDescription)")
        }
        expect(device(userAgent: "Totally legit device, call +1 555"), "Unknown device", "free text")
        expect(device(), "Unknown device", "nothing")
    }

    private static func guessesBrowsersAndSystems() {
        let mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
        expect(device(userAgent: mac), "Chrome on macOS", "chrome mac")
        expect(device(userAgent: mac + " Edg/130.0"), "Edge on macOS", "edge")
        expect(device(userAgent: "Mozilla/5.0 (Windows NT 10.0; rv:131.0) Gecko/20100101 Firefox/131.0"), "Firefox on Windows", "firefox")
        expect(device(userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari on iOS", "safari ios")
        expect(device(userAgent: "Mozilla/5.0 (X11; Linux x86_64)"), "A browser on Linux", "system only")
        expect(device(userAgent: "Something Firefox/1"), "Firefox", "browser only")
        expect(device(userAgent: "node"), "Web sign-in (nuphos.ai)", "node")
        expect(device(userAgent: "Undici/6"), "Web sign-in (nuphos.ai)", "undici")
        // A client was sent, so it is not the website's server.
        expect(device(client: "bad", userAgent: "node"), "Unknown device", "node with client")
        expect(device(userAgent: "nodejs-thing"), "Unknown device", "node prefix")
    }

    private static func labelsPlaces() {
        expect(SignInSessions.place(session(ip: "192.0.2.10", city: "Taipei", country: "TW")), "Taipei, TW · 192.0.2.10", "full")
        expect(SignInSessions.place(session(ip: "198.51.100.4", country: "JP")), "JP · 198.51.100.4", "country")
        expect(SignInSessions.place(session(ip: "203.0.113.9", city: "")), "Unknown location · 203.0.113.9", "no place")
        expect(SignInSessions.place(session()), "Unknown location", "nothing")
    }

    private static func sortsThisDeviceFirstThenMostRecent() {
        let sorted = SignInSessions.sorted([
            session("old", lastUsedAt: "2026-10-01T00:00:00.000Z"),
            session("me", current: true, lastUsedAt: "2026-09-01T00:00:00.000Z"),
            session("unknown", current: nil),
            session("new", lastUsedAt: "2026-10-20T00:00:00.000Z"),
        ])
        precondition(sorted.map(\.id) == ["me", "new", "old", "unknown"], "order: \(sorted.map(\.id))")
    }

    private static func describesActivity() {
        let now = ISO8601DateFormatter().date(from: "2026-10-26T12:00:00Z")!
        expect(SignInSessions.activity(session(current: true), now: now), "Active now", "current")
        expect(SignInSessions.activity(session(lastUsedAt: "2026-10-26T09:00:00.000Z"), now: now), "Last active 3 hours ago", "hours")
        expect(SignInSessions.activity(session(lastUsedAt: "2026-10-24T12:00:00Z"), now: now), "Last active 2 days ago", "plain ISO")
        expect(SignInSessions.activity(session(), now: now), "Last active: unknown", "missing")
    }

    private static func decodesNullFields() {
        let json = #"{"sessions":[{"id":"a","current":null,"createdAt":null,"lastUsedAt":null,"expiresAt":null,"ip":null,"city":null,"country":null,"client":null,"userAgent":null}]}"#
        struct Envelope: Decodable { let sessions: [SignInSession] }
        let decoded = try! JSONDecoder().decode(Envelope.self, from: Data(json.utf8))
        precondition(decoded.sessions.count == 1 && !decoded.sessions[0].isCurrent)
        expect(SignInSessions.device(decoded.sessions[0]), "Unknown device", "null fields")
    }
}
