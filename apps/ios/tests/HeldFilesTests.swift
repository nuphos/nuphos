import Foundation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// A chat with one agent post that pushed a file. Its file group's read never
/// answers, as a slow one does; only cancelling the task ends it.
private final class SlowFilesBackend: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url, !url.path.contains("/attachments/") else { return }
        let body = url.path.hasSuffix("/agents") ? #"{"agents":[]}"# : #"""
            {"kind":"channel","messageCount":1,"transcriptUpdatedAt":"2026-11-03T09:00:00.000Z","timelineEvents":[],"waitingAnswers":[],"faces":[],
             "messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"Done"},{"type":"transfer-download","groupId":"g-1"}],
               "metadata":{"version":1,"sentAt":"2026-11-03T09:00:00.000Z","sourceSessionId":"agent-1",
                 "sender":{"type":"agent","id":"agent-1","displayName":"Ops"}}}]}
            """#
        client?.urlProtocol(self, didReceive: HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// A chat shows its posts as soon as they are read, not once their files are (#3525):
/// a file card reads its own files when the chat has not yet.
@main
enum HeldFilesTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(SlowFilesBackend.self)
        let chat = ChannelSession(token: "token", teamId: "team", channelId: "chat", title: "Chat")
        let read = Task { await chat.refresh() }
        try? await Task.sleep(for: .milliseconds(500))
        check(chat.loaded && chat.loadError == nil, "The chat was still loading while its file was read: \(chat.loadError ?? "no error")")
        check(chat.posts.map(\.id) == ["m1"], "The post waited on its file: \(chat.posts.map(\.id))")
        check(chat.files.isEmpty, "The held file read answered")
        read.cancel()
        await read.value
        print("Held files passed")
    }
}
