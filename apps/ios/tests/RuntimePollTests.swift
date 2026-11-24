import Foundation
import Observation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// Stand-ins for what the sources under test only name.
final class Analytics {
    static let shared = Analytics()
    func track(_ event: String, teamID: String? = nil, properties: [String: Any] = [:]) {}
}

@Observable final class AuthSession { var user: NuphosUser? }

/// Answers the team's runtime and device lists and counts those reads. The
/// conversation listings get an empty page; everything else is a 404. The
/// counters sit behind a lock: URLSession may call `startLoading` on the main
/// thread, where a `DispatchQueue.main.sync` would deadlock.
private final class Backend: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    nonisolated(unsafe) static var runtimes = ""
    nonisolated(unsafe) static var runtimeReads = 0
    nonisolated(unsafe) static var deviceReads = 0
    nonisolated(unsafe) static var runtimeFailures = 0
    static func snapshot() -> (runtimes: String, runtimeReads: Int, deviceReads: Int) {
        lock.lock()
        defer { lock.unlock() }
        return (runtimes, runtimeReads, deviceReads)
    }
    static func setRuntimes(_ rows: String) {
        lock.lock()
        runtimes = rows
        lock.unlock()
    }
    static func failRuntimes(_ count: Int) {
        lock.lock()
        runtimeFailures = count
        lock.unlock()
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        var status = 404
        var body = "{}"
        if request.httpMethod == "GET", url.path.hasSuffix("/agent-runtimes") {
            let rows: String? = {
                Self.lock.lock()
                defer { Self.lock.unlock() }
                Self.runtimeReads += 1
                if Self.runtimeFailures > 0 {
                    Self.runtimeFailures -= 1
                    return nil
                }
                return Self.runtimes
            }()
            if let rows = rows {
                status = 200
                body = #"{"runtimes":[\#(rows)]}"#
            } else {
                status = 500
                body = #"{"error":"runtime list failed"}"#
            }
        } else if request.httpMethod == "GET", url.path.hasSuffix("/agent/devices") {
            Self.lock.lock()
            Self.deviceReads += 1
            Self.lock.unlock()
            status = 200
            body = #"{"devices":[]}"#
        } else if request.httpMethod == "GET", url.path.hasSuffix("/agent/conversations") {
            status = 200
            body = #"{"conversations":[],"nextCursor":null,"hasMore":false}"#
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                                               headerFields: ["Content-Type": "application/json"])!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private let signedOut = #"{"id":"codex","provider":"claude-code","label":"Codex","status":"active","kind":"local","local":{"ownerUserId":"u1","deviceId":"box","deviceLabel":"Computer 1","signedIn":false}}"#
private let signedIn = #"{"id":"opencode","provider":"claude-code","label":"OpenCode","status":"active","kind":"local","local":{"ownerUserId":"u1","deviceId":"box","deviceLabel":"Computer 1","signedIn":true}}"#

/// The list's own poll keeps reading the runtimes and devices until one is
/// selectable: a Box still coming up lists none yet, and a host that drops on
/// its way can leave "getting ready" before any joins (#5018).
@main
enum RuntimePollTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(Backend.self)
        // A fresh account key per run: the store's launch cache would otherwise
        // restore this team, `select` would return early, and nothing would load.
        Backend.failRuntimes(1)
        let store = AgentStore(token: "token-\(UUID().uuidString)", loadsHistory: true)
        let team = try! JSONDecoder().decode(Team.self, from: Data(#"{"id":"team","name":"Demo Studio"}"#.utf8))
        store.select(team: team)
        store.startPolling()
        for _ in 0..<400 where !store.runtimesLoaded { try? await Task.sleep(for: .milliseconds(25)) }
        check(Backend.snapshot().runtimeReads >= 2, "The poller did not retry a failed runtimes load")
        check(store.runtimesLoaded && store.runtimes.isEmpty, "The empty runtime list did not load")
        try? await Task.sleep(for: .milliseconds(4000))
        let reads = Backend.snapshot()
        check(reads.runtimeReads >= 2, "The poller did not re-read the runtimes while none was listed")
        check(reads.deviceReads >= 1, "The poller did not re-read the devices while no runtime was listed")

        Backend.setRuntimes(signedOut)
        for _ in 0..<400 where store.runtimes.isEmpty { try? await Task.sleep(for: .milliseconds(25)) }
        check(store.runtimes.map(\.id) == ["codex"], "The unselectable runtime did not list")
        let before = Backend.snapshot().runtimeReads
        try? await Task.sleep(for: .milliseconds(4500))
        check(Backend.snapshot().runtimeReads > before, "The poller stopped while every listed runtime was unselectable")

        Backend.setRuntimes("\(signedOut),\(signedIn)")
        for _ in 0..<400 where store.runtimes.count < 2 { try? await Task.sleep(for: .milliseconds(25)) }
        check(store.canStartTask, "The selectable runtime did not reach the store")
        let settled = Backend.snapshot().runtimeReads
        try? await Task.sleep(for: .milliseconds(4500))
        check(Backend.snapshot().runtimeReads == settled, "The poller kept reading the runtimes after a selectable one joined")
        print("Runtime poll passed")
    }
}
