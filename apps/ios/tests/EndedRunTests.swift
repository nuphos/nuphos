import Foundation
import ObjectiveC
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

/// A conversation that still names a run whose stream is over. Resuming it
/// answers as the session id says: the stream is gone, it is no longer
/// resumable (409), or it just ends; `unavailable` first fails with a 500 that
/// says nothing about the run, then is gone. Counts each conversation's resumes.
private final class Backend: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var resumes: [String: Int] = [:]
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        if request.httpMethod == "POST", url.path.hasSuffix("/agent/chat") {
            let body = request.httpBody ?? request.httpBodyStream.map(Self.read) ?? Data()
            let id = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])?["id"] as? String ?? ""
            DispatchQueue.main.sync { Self.resumes[id, default: 0] += 1 }
            switch id {
            case "not-resumable":
                answer(url, 409, #"{"error":{"code":"stream_not_resumable","message":"The agent stream is no longer resumable"}}"#, "application/json")
            case "unavailable" where Backend.resumes[id] == 1:
                // A failure that says nothing about the run: it may still be live.
                answer(url, 500, #"{"error":{"message":"Synthetic failure"}}"#, "application/json")
            case "ended":
                answer(url, 200, "data: {\"type\":\"atlas-stream-done\"}\n\n", "text/event-stream")
            default:
                answer(url, 200, """
                data: {"type":"error","errorCode":"stream_unresumable","errorText":"Agent run stream is no longer available"}

                data: {"type":"atlas-stream-done"}


                """, "text/event-stream")
            }
            return
        }
        let parts = url.pathComponents
        if request.httpMethod == "GET", parts.count >= 2, parts[parts.count - 2] == "conversations", let id = parts.last {
            answer(url, 200, """
            {"sessionId":"\(id)","teamId":"team","title":"\(id)","isOwner":true,"readOnly":false,"messagesFirstIndex":0,
             "agentRuntime":"codex","activeRun":{"streamId":"run-over"},
             "messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Question"}]},
                         {"id":"a1","role":"assistant","parts":[{"type":"text","text":"Stored reply"}]}]}
            """, "application/json")
            return
        }
        answer(url, 404, "{}", "application/json")
    }
    private static func read(_ stream: InputStream) -> Data {
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        stream.open()
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        stream.close()
        return data
    }
    private func answer(_ url: URL, _ status: Int, _ body: String, _ type: String) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                                               headerFields: ["Content-Type": type])!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// `SSEClient` builds its session from `URLSessionConfiguration.default`, which
/// `URLProtocol.registerClass` does not reach: put the stub in it.
private extension URLSessionConfiguration {
    @objc class func stubbedDefault() -> URLSessionConfiguration {
        let configuration = stubbedDefault()
        configuration.protocolClasses = [Backend.self]
        return configuration
    }
}

@main
enum EndedRunTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(Backend.self)
        method_exchangeImplementations(
            class_getClassMethod(URLSessionConfiguration.self, NSSelectorFromString("defaultSessionConfiguration"))!,
            class_getClassMethod(URLSessionConfiguration.self, #selector(URLSessionConfiguration.stubbedDefault))!
        )
        LaunchCache.clear()

        // A run attached to and over is not attached to again, however long the
        // conversation still names it: neither by the idle poll nor by a reopen.
        for id in ["unresumable", "not-resumable", "ended"] {
            let session = ChatSession(token: "test-token", teamId: "team", sessionId: id)
            await session.load()
            let poll = Task { await session.pollWhileIdle() }
            try? await Task.sleep(for: .seconds(7))
            await session.revalidate()
            try? await Task.sleep(for: .seconds(1))
            poll.cancel()
            check(Backend.resumes[id] == 1, "\(id): the run over was resumed \(Backend.resumes[id] ?? 0) times")
            check(!session.transportStreaming, "\(id): the chat still shows the run over as live")
            check(session.messages.last?.text == "Stored reply", "\(id): the stored transcript is not shown")
        }

        // A failed attach is not an ended run: the idle poll attaches again, once.
        let session = ChatSession(token: "test-token", teamId: "team", sessionId: "unavailable")
        await session.load()
        let poll = Task { await session.pollWhileIdle() }
        try? await Task.sleep(for: .seconds(8))
        poll.cancel()
        check(Backend.resumes["unavailable"] == 2, "unavailable: resumed \(Backend.resumes["unavailable"] ?? 0) times, not again after a failed attach and then once")

        LaunchCache.clear()
        print("EndedRunTests passed")
    }
}
