#if DEBUG
import Foundation
import OSLog

/// Opt-in simulator fixtures; never compiled into a release build.
nonisolated final class PreviewTransport: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "api.nuphos.ai" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { return }
        let env = ProcessInfo.processInfo.environment
        let file = env["NUPHOS_PREVIEW_RESPONSES"] ?? UserDefaults.standard.string(forKey: "previewResponses") ?? ""
        let responses = (try? Data(contentsOf: URL(fileURLWithPath: file))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        let key = "\(request.httpMethod ?? "GET") \(url.path)"
        // Simulator regression scripts read this to see which requests ran.
        Logger(subsystem: "ai.nuphos.ios", category: "preview").notice("preview_request \(key, privacy: .public)")
        // `GET /path?name=value` answers only requests with that query item; the last items are the
        // narrowest filters (a chats listing's `kind=channel`), so they are tried first.
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let entry = items.reversed().lazy.compactMap { responses["\(key)?\($0.name)=\($0.value ?? "")"] as? [String: Any] }.first
            ?? responses[key] as? [String: Any]
        let status = entry?["status"] as? Int ?? 404
        let body = entry?["body"] ?? ["error": ["message": "No preview response for \(key)"]]
        // `$FIXTURE_DIR` in a body is the fixture's folder, so a transfer link can name a local image:
        // image views load with their own session, which this transport never sees.
        let json = (try? JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed, .withoutEscapingSlashes])) ?? Data()
        let folder = URL(fileURLWithPath: file).deletingLastPathComponent().path
        let data = Data((String(data: json, encoding: .utf8) ?? "").replacingOccurrences(of: "$FIXTURE_DIR", with: folder).utf8)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: (entry?["headers"] as? [String: String]) ?? ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
