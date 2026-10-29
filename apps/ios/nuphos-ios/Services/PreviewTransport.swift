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
        let entry = responses[key] as? [String: Any]
        let status = entry?["status"] as? Int ?? 404
        let body = entry?["body"] ?? ["error": ["message": "No preview response for \(key)"]]
        let data = (try? JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed])) ?? Data()
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
#endif
