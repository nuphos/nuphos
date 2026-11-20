import Foundation
import ObjectiveC

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// A backend that pushes one change to the open chat shortly after its change stream opens,
/// and keeps the stream open. Every other request gets an empty 200. Records what was asked.
private final class PushingBackend: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var seen: [(at: ContinuousClock.Instant, request: String)] = []
    nonisolated(unsafe) static var pushedAt: ContinuousClock.Instant?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let tail = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "tail" }?.value
        Self.seen.append((.now, "\(request.httpMethod ?? "GET") \(url.path)\(tail.map { "?tail=\($0)" } ?? "")"))
        let stream = url.path.hasSuffix("/agent-changes")
        client?.urlProtocol(self, didReceive: HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": stream ? "text/event-stream" : "application/json"])!, cacheStoragePolicy: .notAllowed)
        guard stream else {
            client?.urlProtocol(self, didLoad: Data("{}".utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        let client = client
        DispatchQueue.global().asyncAfter(deadline: .now() + 1) {
            client?.urlProtocol(self, didLoad: Data("data: {\"sessionId\":\"other\",\"revision\":\"r\"}\n\n".utf8))
            Self.pushedAt = .now
            client?.urlProtocol(self, didLoad: Data("data: {\"sessionId\":\"chat\",\"revision\":\"r2\"}\n\n".utf8))
        }
    }
    override func stopLoading() {}
}

/// `SSEClient` builds its session from `URLSessionConfiguration.default`, which
/// `URLProtocol.registerClass` does not reach: put the stub in it.
private extension URLSessionConfiguration {
    @objc class func stubbedDefault() -> URLSessionConfiguration {
        let configuration = stubbedDefault()
        configuration.protocolClasses = [PushingBackend.self]
        return configuration
    }
}

/// An open chat hears from the server that it changed (#3906) and reads at once, instead of at
/// its next 4 s poll; while that stream is up it does not poll the chat at all.
@main
enum ChannelPushTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(PushingBackend.self)
        let original = class_getClassMethod(URLSessionConfiguration.self, NSSelectorFromString("defaultSessionConfiguration"))!
        let stubbed = class_getClassMethod(URLSessionConfiguration.self, #selector(URLSessionConfiguration.stubbedDefault))!
        method_exchangeImplementations(original, stubbed)

        let chat = ChannelSession(token: "token", teamId: "team", channelId: "chat", title: "Chat")
        let following = Task { await chat.poll() }
        // Past the push at 1 s and the poll's next tick at 4 s.
        try? await Task.sleep(for: .milliseconds(5_500))
        following.cancel()

        let seen = PushingBackend.seen
        check(seen.contains { $0.request == "GET /teams/team/agent-changes" }, "The chat never followed the team's changes: \(seen.map(\.request))")
        guard let pushedAt = PushingBackend.pushedAt else { return check(false, "The change was never pushed") }
        let read = seen.first { $0.at >= pushedAt && $0.request == "GET /agent/conversations/chat?tail=200" }
        check(read != nil, "The chat was not read after its change was pushed: \(seen.map(\.request))")
        check(read!.at - pushedAt < .milliseconds(500), "The chat was read \(read!.at - pushedAt) after the push")
        check(!seen.contains { $0.request == "GET /agent/conversations/chat?tail=1" },
              "The chat kept polling while the change stream was up: \(seen.map(\.request))")
        check(seen.filter { $0.request == "GET /agent/conversations/chat?tail=200" }.count == 3,
              "Expected three reads (first, the stream coming up, the pushed change): \(seen.map(\.request))")
        print("Channel push passed")
    }
}
