import Foundation
import WebKit

/// Answers the phone's Mac-only page from the Mac: each request goes over the owner's device
/// tunnel and is fetched there. WebSockets don't pass, so a dev server's live reload doesn't
/// reach the phone.
@MainActor
final class MacPageProxy: NSObject, WKURLSchemeHandler {
    private let fetch: (DockFetchRequest) async throws -> DockFetchResponse
    private var running: [ObjectIdentifier: Task<Void, Never>] = [:]

    init(fetch: @escaping (DockFetchRequest) async throws -> DockFetchResponse) {
        self.fetch = fetch
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        guard let phone = task.request.url, let mac = MacPageScheme.macURL(phone) else {
            task.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let request = DockFetchRequest(
            url: mac.absoluteString,
            method: task.request.httpMethod ?? "GET",
            headers: task.request.allHTTPHeaderFields ?? [:],
            body: task.request.httpBody?.base64EncodedString(),
            document: task.request.mainDocumentURL == phone
        )
        running[id] = Task { [weak self] in
            do {
                let answer = try await self?.fetch(request)
                // A task WebKit stopped meanwhile must not be answered.
                guard let self, let answer, self.running.removeValue(forKey: id) != nil else { return }
                let response = HTTPURLResponse(url: phone, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: answer.headers)
                    ?? HTTPURLResponse(url: phone, statusCode: 502, httpVersion: nil, headerFields: nil)!
                task.didReceive(response)
                task.didReceive(Data(base64Encoded: answer.body) ?? Data())
                task.didFinish()
            } catch {
                guard self?.running.removeValue(forKey: id) != nil else { return }
                task.didFailWithError(error)
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        running.removeValue(forKey: ObjectIdentifier(task))?.cancel()
    }
}
