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

/// One owned Claude Code chat. Its model settings name the agent it is on; a read
/// of them on Claude Code waits while `held`. A move puts it on Codex. Everything else is a 404.
private final class Backend: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var held = false
    nonisolated(unsafe) static var moved = false
    nonisolated(unsafe) static var configReads = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let parts = url.pathComponents
        var status = 404
        var body = "{}"
        if request.httpMethod == "GET", parts.last == "move" {
            status = 200
            body = """
            {"sessionId":"move","teamId":"team","title":"move","isOwner":true,"readOnly":false,"messagesFirstIndex":0,
             "agentRuntime":"claude-code","runtimeId":"claude","runtimeLabel":"Claude Code",
             "messages":[{"id":"m-move","role":"assistant","parts":[{"type":"text","text":"Stored reply"}]}]}
            """
        } else if request.httpMethod == "POST", parts.last == "runtime" {
            DispatchQueue.main.sync { Self.moved = true }
            status = 200
            body = #"{"runtimeId":"codex","runtimeLabel":"Codex","agentRuntime":"codex"}"#
        } else if request.httpMethod == "GET", parts.last == "model-config" {
            let (held, moved) = DispatchQueue.main.sync { Self.configReads += 1; return (Self.held, Self.moved) }
            let model = moved ? "codex-model" : "claude-model"
            let body = """
            {"status":"ready","options":[{"id":"model","name":"Model","kind":"model","currentValue":"\(model)",
             "options":[{"value":"\(model)","name":"\(model)"}]}]}
            """
            if held && !moved {
                DispatchQueue.global().async { [self] in
                    while DispatchQueue.main.sync(execute: { Self.held }) { usleep(20_000) }
                    answer(url, 200, body)
                }
                return
            }
            answer(url, 200, body)
            return
        }
        answer(url, status, body)
    }
    private func answer(_ url: URL, _ status: Int, _ body: String) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                                               headerFields: ["Content-Type": "application/json"])!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// A move while the old agent's model settings are still being read shows the new agent's model (#4214).
@main
enum RuntimeMoveTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(Backend.self)
        Backend.held = true
        let chat = ChatSession(token: "token", teamId: "team", sessionId: "move", title: "move")
        await chat.load()
        for _ in 0..<200 where Backend.configReads == 0 { try? await Task.sleep(for: .milliseconds(25)) }
        check(Backend.configReads == 1, "Loading the chat did not read its model settings")

        let codex = try! JSONDecoder().decode(RuntimeInstance.self, from: Data(#"{"id":"codex","provider":"codex","label":"Codex","status":"active","kind":"cloud"}"#.utf8))
        do { try await chat.move(to: codex) } catch { check(false, "The move failed: \(error)") }
        check(chat.sessionConfig?.model?.currentValue == "codex-model",
              "Right after the move the model is \(chat.sessionConfig?.model?.currentValue ?? "blank")")

        // The old agent's read lands last and must not replace the new agent's settings.
        Backend.held = false
        try? await Task.sleep(for: .milliseconds(300))
        check(chat.sessionConfig?.model?.currentValue == "codex-model",
              "The old agent's read replaced the model with \(chat.sessionConfig?.model?.currentValue ?? "blank")")
        print("Runtime move passed")
    }
}
