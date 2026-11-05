#if DEBUG
import Foundation
import ObjectiveC
import OSLog

/// Keeps a preview run off the network: fixtures must never reach a real
/// backend, whichever session or view asks. Never compiled into a release build.
nonisolated enum PreviewIsolation {
    /// A reserved name that cannot resolve, so the API stays unreachable even from
    /// a path no transport can see, such as a web socket.
    static let apiBase = URL(string: "https://api.preview.invalid")!

    enum Route: Equatable {
        /// Answered from the fixture.
        case fixture
        /// This machine, or not the network at all.
        case local
        case blocked
    }

    private(set) nonisolated(unsafe) static var isActive = false
    private static let log = Logger(subsystem: "ai.nuphos.ios", category: "preview")

    static func isPreview(arguments: [String], fixture: String?) -> Bool {
        if arguments.contains("-share-verification") { return false }
        return fixture != nil || arguments.contains { $0.hasPrefix("-preview") }
    }

    static func route(_ url: URL?) -> Route {
        guard let url, let scheme = url.scheme?.lowercased() else { return .blocked }
        guard ["http", "https", "ws", "wss"].contains(scheme) else { return .local }
        let host = url.host?.lowercased()
        if host == apiBase.host { return .fixture }
        return ["127.0.0.1", "localhost", "::1"].contains(host) ? .local : .blocked
    }

    /// Whether a view that no transport can reach must not open `url`.
    static func refuses(_ url: URL) -> Bool {
        guard isActive, route(url) == .blocked else { return false }
        report(url)
        return true
    }

    static func report(_ url: URL?) {
        log.notice("preview_blocked \(url?.absoluteString ?? "", privacy: .public)")
    }

    /// Call before anything can open a session.
    static func installIfPreview(
        arguments: [String] = CommandLine.arguments,
        fixture: String? = launchFixture()
    ) {
        guard !isActive, isPreview(arguments: arguments, fixture: fixture) else { return }
        isActive = true
        if route(NuphosAPI.baseURL) != .local { NuphosAPI.sharedSessionBaseURL = apiBase }
        URLProtocol.registerClass(PreviewTransport.self)
        URLSessionConfiguration.routeThroughPreviewTransport()
    }

    private static func launchFixture() -> String? {
        #if targetEnvironment(simulator)
        ProcessInfo.processInfo.environment["NUPHOS_PREVIEW_RESPONSES"]
            ?? UserDefaults.standard.string(forKey: "previewResponses")
        #else
        nil
        #endif
    }
}

/// `URLProtocol.registerClass` reaches `URLSession.shared` only. A session built
/// from a configuration, as `SSEClient` and `AsyncImage` build theirs, is reached here.
private extension URLSessionConfiguration {
    @objc class func previewDefault() -> URLSessionConfiguration { previewDefault().withPreviewTransport() }
    @objc class func previewEphemeral() -> URLSessionConfiguration { previewEphemeral().withPreviewTransport() }

    func withPreviewTransport() -> URLSessionConfiguration {
        protocolClasses = [PreviewTransport.self] + (protocolClasses ?? [])
        return self
    }
}

extension URLSessionConfiguration {
    fileprivate static func routeThroughPreviewTransport() {
        for (name, replacement) in [
            ("defaultSessionConfiguration", #selector(previewDefault)),
            ("ephemeralSessionConfiguration", #selector(previewEphemeral)),
        ] {
            guard let original = class_getClassMethod(self, NSSelectorFromString(name)),
                  let isolated = class_getClassMethod(self, replacement) else {
                preconditionFailure("Preview mode cannot isolate \(name)")
            }
            method_exchangeImplementations(original, isolated)
        }
    }
}
#endif
