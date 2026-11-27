import Foundation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// Reads of each file group, counted by the backend below.
nonisolated(unsafe) private var fileReads: [String: Int] = [:]

/// A chat with one agent post that pushed two file groups. Their links are
/// presigned for minutes: g-stale's has already run out, as it has once the
/// chat sat open (or in the background) past it; g-fresh's has not.
private final class StaleLinksBackend: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let body: String
        if url.path.contains("/attachments/") {
            let group = url.lastPathComponent
            fileReads[group, default: 0] += 1
            let read = fileReads[group]!
            let expiry = ISO8601DateFormatter.string(
                from: Date(timeIntervalSinceNow: group == "g-stale" ? -60 : 900), timeZone: .gmt,
                formatOptions: [.withInternetDateTime, .withFractionalSeconds])
            body = #"""
                {"groupId":"\#(group)","createdAt":"2026-11-03T09:00:00.000Z","expiresAt":"2099-01-01T00:00:00.000Z",
                 "files":[{"id":"f-\#(group)","fileName":"frame.png","contentType":"image/png","status":"ready",
                   "downloadUrl":"https://files.example.com/\#(group)?read=\#(read)","downloadExpiresAt":"\#(expiry)"}]}
                """#
        } else if url.path.hasSuffix("/agents") {
            body = #"{"agents":[]}"#
        } else {
            body = #"""
                {"kind":"channel","messageCount":1,"transcriptUpdatedAt":"2026-11-03T09:00:00.000Z","timelineEvents":[],"waitingAnswers":[],"faces":[],
                 "messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"Cuts"},{"type":"transfer-download","groupId":"g-stale"},{"type":"transfer-download","groupId":"g-fresh"}],
                   "metadata":{"version":1,"sentAt":"2026-11-03T09:00:00.000Z","sourceSessionId":"agent-1",
                     "sender":{"type":"agent","id":"agent-1","displayName":"Ops"}}}]}
                """#
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(
            url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

/// A file's link is held only while it works. Once it has expired, the next
/// refresh reads it again, even when the chat itself has not changed; a link
/// that still works is not read again.
@main
enum StaleLinksTests {
    @MainActor
    static func main() async {
        URLProtocol.registerClass(StaleLinksBackend.self)
        let chat = ChannelSession(token: "token", teamId: "team", channelId: "stale-links", title: "Chat")
        await chat.refresh()
        check(fileReads == ["g-stale": 1, "g-fresh": 1], "First read: \(fileReads)")
        // The chat is unchanged: the probe matches, as it does on returning to it.
        await chat.refresh()
        await chat.refresh()
        check(fileReads["g-stale"] == 3, "An expired link was kept, read \(fileReads["g-stale"] ?? 0) times over 3 refreshes")
        check(chat.files["g-stale"]?.first?.downloadUrl == "https://files.example.com/g-stale?read=3",
              "The chat still shows an expired link: \(chat.files["g-stale"]?.first?.downloadUrl ?? "none")")
        check(fileReads["g-fresh"] == 1, "A working link was read again: \(fileReads["g-fresh"] ?? 0) times")
        print("Stale links passed")
    }
}
