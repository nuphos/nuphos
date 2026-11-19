import Foundation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// Answers every request with a 500, or, while `holding`, never answers, so
/// only cancelling the task ends the request, as leaving a chat does.
private final class StubTransport: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var holding = true
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard !Self.holding, let url = request.url else { return }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 500, httpVersion: "HTTP/1.1", headerFields: nil)!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":{"message":"Synthetic failure"}}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// A chat's read that is cancelled (the chat closed, the app left the
/// foreground) is not a failure: it records nothing, so the next read loads (#3620).
@main
enum CancelledLoadTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(StubTransport.self)
        await aCancelledReadRecordsNoFailure()
        await aFailedReadIsStillShown()
        print("Cancelled loads passed")
    }

    @MainActor
    private static func aCancelledReadRecordsNoFailure() async {
        StubTransport.holding = true
        let chat = ChannelSession(token: "token", teamId: "team", channelId: "chat", title: "Chat")
        let read = Task { await chat.refresh() }
        try? await Task.sleep(for: .milliseconds(300))
        read.cancel()
        await read.value
        check(chat.loadError == nil, "A cancelled read showed \"\(chat.loadError ?? "")\"")
        check(!chat.loaded, "A cancelled read counted as loaded, so the chat would not read again")
    }

    /// The control: the same read failing for real is still reported.
    @MainActor
    private static func aFailedReadIsStillShown() async {
        StubTransport.holding = false
        let chat = ChannelSession(token: "token", teamId: "team", channelId: "chat", title: "Chat")
        await chat.refresh()
        check(chat.loadError == "Synthetic failure", "A failed read was not shown, got \(chat.loadError ?? "nil")")
        check(chat.loaded, "A failed read left the chat loading")
    }
}
