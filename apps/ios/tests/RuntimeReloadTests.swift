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

/// Answers the team's runtime list with `runtimes` and counts those reads. Everything else is a 404.
private final class Backend: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var runtimes: [String] = []
    nonisolated(unsafe) static var reads = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        var status = 404
        var body = "{}"
        if request.httpMethod == "GET", url.lastPathComponent == "agent-runtimes" {
            let ids = DispatchQueue.main.sync { Self.reads += 1; return Self.runtimes }
            let rows = ids.map { #"{"id":"\#($0)","provider":"claude-code","label":"Claude Code","status":"active","kind":"local","local":{"ownerUserId":"u1","deviceId":"mac","deviceLabel":"Demo Mac","signedIn":true}}"# }
            status = 200
            body = #"{"runtimes":[\#(rows.joined(separator: ","))]}"#
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                                               headerFields: ["Content-Type": "application/json"])!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// A runtime that joins after the list loaded empty shows on the next reload.
@main
enum RuntimeReloadTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(Backend.self)
        let store = AgentStore(token: "token", loadsHistory: false)
        let team = try! JSONDecoder().decode(Team.self, from: Data(#"{"id":"team","name":"Demo Studio"}"#.utf8))
        store.select(team: team)
        for _ in 0..<200 where !store.runtimesLoaded { try? await Task.sleep(for: .milliseconds(25)) }
        check(store.runtimesLoaded && store.runtimes.isEmpty, "The empty list did not load")

        Backend.runtimes = ["local_u1_mac_claude-code"]
        await store.reload()
        check(Backend.reads == 2, "Reload did not read the runtimes again")
        check(store.runtimes.map(\.id) == ["local_u1_mac_claude-code"], "The runtime that joined is not shown after reload")
        print("Runtime reload passed")
    }
}
