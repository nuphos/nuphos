import Foundation

enum SSEClientTests {
    static func run() {
        closesARejectedResponse()
        print("SSE client passed")
    }

    /// Answers 200 with a body that is not an event stream and never ends,
    /// like a server holding the connection open.
    final class HeldOpen: URLProtocol {
        nonisolated(unsafe) static var stopped = false

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/plain"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            // Over 512 bytes: URLSession holds a text/plain response back
            // until it has that much to sniff.
            client?.urlProtocol(self, didLoad: Data(String(repeating: "still sending\n", count: 100).utf8))
        }

        override func stopLoading() { HeldOpen.stopped = true }
    }

    private final class Box: @unchecked Sendable { var error: Error? }

    /// A response rejected before its body is read must close the connection
    /// with it, not leave it filling a buffer nobody reads.
    private static func closesARejectedResponse() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [HeldOpen.self]
        let request = URLRequest(url: URL(string: "https://example.invalid/sse")!)
        let done = DispatchSemaphore(value: 0)
        let box = Box()
        Task.detached {
            do { for try await _ in SSEClient.events(for: request, configuration: configuration) {} } catch { box.error = error }
            done.signal()
        }
        precondition(done.wait(timeout: .now() + 5) == .success, "the reader must finish")
        guard case SSEClient.Failure.notEventStream? = box.error else {
            preconditionFailure("expected notEventStream, got \(String(describing: box.error))")
        }
        let deadline = Date().addingTimeInterval(2)
        while !HeldOpen.stopped, Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
        precondition(HeldOpen.stopped, "a rejected response must cancel its connection")
    }
}
