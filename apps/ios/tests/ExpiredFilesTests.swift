import Foundation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// Reads of the chat's file groups, counted by the backend below.
nonisolated(unsafe) private var fileReads = 0

/// A chat with one agent post that pushed two file groups. One expired and the
/// backend purged it (404 transfer_not_found); the other answers 410.
private final class ExpiredFilesBackend: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        var status = 200
        let body: String
        if url.path.contains("/attachments/") {
            fileReads += 1
            status = url.path.hasSuffix("/g-gone") ? 404 : 410
            body = status == 404
                ? #"{"error":{"code":"transfer_not_found","message":"File transfer not found"}}"#
                : #"{"error":{"code":"transfer_expired","message":"File transfer has expired"}}"#
        } else if url.path.hasSuffix("/agents") {
            body = #"{"agents":[]}"#
        } else {
            body = #"""
                {"kind":"channel","messageCount":1,"transcriptUpdatedAt":"2026-11-03T09:00:00.000Z","timelineEvents":[],"waitingAnswers":[],"faces":[],
                 "messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"Done"},{"type":"transfer-download","groupId":"g-gone"},{"type":"transfer-download","groupId":"g-expired"}],
                   "metadata":{"version":1,"sentAt":"2026-11-03T09:00:00.000Z","sourceSessionId":"agent-1",
                     "sender":{"type":"agent","id":"agent-1","displayName":"Ops"}}}]}
                """#
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(
            url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// An expired file group is read once: it shows as expired, and no later refresh reads it again.
@main
enum ExpiredFilesTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(ExpiredFilesBackend.self)
        let chat = ChannelSession(token: "token", teamId: "team", channelId: "chat", title: "Chat")
        for _ in 1...4 { await chat.refresh(force: true) }
        check(fileReads == 2, "Expired file groups were read \(fileReads) times over 4 refreshes, not once each")
        check(chat.files["g-gone"]?.isEmpty == true && chat.files["g-expired"]?.isEmpty == true,
              "Expired file groups are not held as having no files: \(chat.files.keys.sorted())")
        print("Expired files passed")
    }
}
