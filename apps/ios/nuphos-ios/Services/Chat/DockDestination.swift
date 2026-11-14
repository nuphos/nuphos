import Foundation

/// A conversation's dock, mirrored from the owner's Nuphos Desktop: every tab (a web page, a
/// terminal, Files…), the one in front, and the Mac's New Tab history.
struct DockState: Decodable, Equatable, Sendable {
    var tabs: [DockTab]
    var activeTabId: String?
    var recent: [DockRecent]
}

/// One tab in the dock, any page. `kind` is the Mac's page key, e.g. `team.browser`.
struct DockTab: Decodable, Identifiable, Equatable, Hashable, Sendable {
    let id: String
    let kind: String
    let title: String
    /// The app path the tab shows, as the Mac names pages.
    let href: String
    /// A browser tab's web address.
    var url: String?

    var destination: DockDestination { DockDestination(href: href, url: url, kind: kind) }
}

/// A page the Mac's dock has shown, most frecent first, as its New Tab offers them.
struct DockRecent: Decodable, Identifiable, Equatable, Hashable, Sendable {
    let href: String
    let title: String
    var url: String?

    var id: String { href }
    var destination: DockDestination { DockDestination(href: href, url: url, kind: nil) }
}

/// Where a dock page opens on the phone: a web page in its own browser, an iPhone screen that
/// shows the same thing, or the Mac, for the pages the iPhone doesn't have yet.
enum DockDestination: Equatable, Hashable, Sendable {
    case web(URL)
    /// A Browser tab with no page yet: the phone's browser, ready for an address.
    case newBrowser
    case desktop
    case runtimes
    case connectors
    case chat(sessionId: String)
    /// The Runtime terminal: a shell on the computer the conversation runs on, opened here.
    case terminal
    /// Files, the Mac's own terminal, Architecture, Designs, Dashboards, Monitoring: Mac only for now. The
    /// Mac opens `href` where there is one, else the page by its key.
    case onMac(page: String, href: String?)

    /// The Mac's workspace page keys the iPhone opens itself; the rest open on the Mac.
    private static let phonePages: [String: DockDestination] = [
        "team.browser": .newBrowser, "team.desktop": .desktop,
        "team.runtimes": .runtimes, "team.integrations": .connectors,
    ]

    init(href: String, url: String?, kind: String?) {
        if let url, let web = URL(string: url), ["http", "https"].contains(web.scheme?.lowercased()) {
            self = .web(web)
            return
        }
        let page = kind ?? Self.page(ofPath: href)
        if page == "team.agent", let session = Self.segments(href).dropFirst(3).first {
            self = .chat(sessionId: session)
            return
        }
        if page == "team.terminal", Self.segments(href).dropFirst(3).first == "runtime" {
            self = .terminal
            return
        }
        self = Self.phonePages[page] ?? .onMac(page: page, href: href.isEmpty ? nil : href)
    }

    /// `/teams/<team>/files/…` → `team.files`, as the Mac keys its pages.
    static func page(ofPath href: String) -> String {
        let parts = segments(href)
        guard parts.count >= 3, parts[0] == "teams" else { return "" }
        return "team.\(parts[2])"
    }

    private static func segments(_ href: String) -> [String] {
        let path = URLComponents(string: href)?.path ?? href
        return path.split(separator: "/").map { String($0).removingPercentEncoding ?? String($0) }
    }

    /// A page on the Mac itself or its network: loopback, `.local`, or a private address. The
    /// phone can't reach it directly.
    static func isLocal(_ url: URL) -> Bool {
        guard let host = url.host()?.lowercased() else { return false }
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") || host == "::1" || host == "[::1]" { return true }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else { return false }
        switch (octets[0], octets[1]) {
        case (127, _), (10, _), (192, 168), (169, 254): return true
        case (172, let second): return (16...31).contains(second)
        default: return false
        }
    }

    /// The Mac's New Tab address rule: what typed text reads as a web address, or nil.
    static func address(_ input: String) -> URL? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        func matches(_ pattern: String) -> Bool { text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil }
        if matches("^https?://") { return URL(string: text) }
        if matches(#"^(localhost|127\.0\.0\.1|\[::1\])([:/?#]|$)"#) { return URL(string: "http://\(text)") }
        if matches(#"^\d{1,3}(\.\d{1,3}){3}([:/?#]|$)"#) {
            let ip = text.prefix { $0.isNumber || $0 == "." }
            guard ip.split(separator: ".").allSatisfy({ (Int($0) ?? 256) <= 255 }) else { return nil }
            return URL(string: "http://\(text)")
        }
        if matches(#"^[\w.-]+\.[a-z]{2,}([:/?#]|$)"#) { return URL(string: "https://\(text)") }
        return nil
    }

    /// What typed text opens: its address, or a search for it, as the Mac's browser does.
    static func addressOrSearch(_ input: String) -> URL? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if let url = address(text) { return url }
        var search = URLComponents(string: "https://www.google.com/search")!
        search.queryItems = [URLQueryItem(name: "q", value: text)]
        return search.url
    }
}

/// The Mac's New Tab "Workspace" group, mirrored: Terminal is two destinations there too.
struct DockWorkspaceItem: Identifiable, Hashable, Sendable {
    let page: String
    let title: String
    let systemImage: String
    /// An app path to open instead of the page's own, as the runtime terminal does.
    var path: String?

    var id: String { page + (path ?? "") }
    var destination: DockDestination {
        path.map { DockDestination(href: $0, url: nil, kind: nil) } ?? DockDestination(href: "", url: nil, kind: page)
    }

    static func all(teamId: String, desktop: Bool) -> [DockWorkspaceItem] {
        let team = teamId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? teamId
        return [
            .init(page: "team.browser", title: "Browser", systemImage: "globe"),
            .init(page: "team.files", title: "Files", systemImage: "folder"),
            .init(page: "team.terminal", title: "Local terminal", systemImage: "terminal"),
            .init(page: "team.terminal", title: "Runtime terminal", systemImage: "server.rack", path: "/teams/\(team)/terminal/runtime"),
            .init(page: "team.architecture", title: "Architecture", systemImage: "point.3.connected.trianglepath.dotted"),
            .init(page: "team.designs", title: "Designs", systemImage: "paintpalette"),
            .init(page: "team.dashboards", title: "Dashboards", systemImage: "chart.xyaxis.line"),
            .init(page: "team.monitoring", title: "Monitoring", systemImage: "waveform.path.ecg"),
        ] + (desktop ? [.init(page: "team.desktop", title: "Desktop", systemImage: "display")] : [])
    }
}

/// A request of a page that lives on the owner's Mac or its network, as the phone's browser
/// sends it to be fetched there. `document` is the page itself rather than one of its assets.
struct DockFetchRequest: Codable, Equatable, Sendable {
    var url: String
    var method: String
    var headers: [String: String]
    var body: String?
    var document: Bool
}

struct DockFetchResponse: Decodable, Equatable, Sendable {
    let status: Int
    let url: String
    let headers: [String: String]
    /// Base64.
    let body: String
}

/// The phone loads a Mac-only page under its own schemes, so every request the page makes comes
/// to `MacPageProxy` instead of the network: `http://localhost:3000/` is
/// `nuphos-mac-http://localhost:3000/`. Relative links and assets follow by themselves.
enum MacPageScheme {
    static let http = "nuphos-mac-http"
    static let https = "nuphos-mac-https"

    /// The phone's address for a page on the Mac's network, or nil for any other page.
    static func phoneURL(_ url: URL) -> URL? {
        guard DockDestination.isLocal(url), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        switch parts.scheme?.lowercased() {
        case "http": parts.scheme = http
        case "https": parts.scheme = https
        default: return nil
        }
        return parts.url
    }

    /// The page's own address on the Mac, from the phone's.
    static func macURL(_ url: URL) -> URL? {
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        switch parts.scheme?.lowercased() {
        case http: parts.scheme = "http"
        case https: parts.scheme = "https"
        default: return nil
        }
        return parts.url
    }
}
