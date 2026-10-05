import Foundation

/// One server-sent event: the `event:` name (if any) and the joined `data:`
/// payload. Comment lines (`: …`) are dropped; they are the heartbeat.
struct SSEEvent: Sendable, Equatable {
    var event: String?
    var data: String
    var id: String?
}

/// Minimal SSE reader over a URLSession data task. Yields events as they arrive
/// and enforces two deadlines the desktop client also uses: a first-byte
/// deadline and an idle timeout between bytes.
enum SSEClient {
    enum Failure: LocalizedError {
        case badStatus(Int, body: String?)
        case notEventStream(String?)
        case firstByteTimeout
        case idleTimeout
        /// Heartbeats kept coming but no event did — a dead run.
        case frameTimeout

        var errorDescription: String? {
            switch self {
            case .badStatus(let code, let body): body.flatMap(SSEClient.errorMessage) ?? "Nuphos returned status \(code)."
            case .notEventStream(let type): "Expected an event stream, got \(type ?? "nothing")."
            case .firstByteTimeout: "Nuphos did not start responding in time."
            case .idleTimeout: "The connection went quiet for too long."
            case .frameTimeout: "The runtime went quiet; the reply was closed."
            }
        }
    }

    /// Opens `request` and streams its events. The stream ends when the
    /// server closes the connection; cancel the consuming task to abort.
    static func events(
        for request: URLRequest,
        firstByteTimeout: Duration = .seconds(5),
        idleTimeout: Duration = .seconds(45),
        frameTimeout: Duration = .seconds(40 * 60),
        configuration: URLSessionConfiguration = .default
    ) -> AsyncThrowingStream<SSEEvent, Error> {
        AsyncThrowingStream { continuation in
            let activity = ActivityClock()
            // Reset by events only, never by heartbeats: the backend's stall
            // sweeper ends a silent run after 35 minutes, so a client that
            // keeps reconnecting past that is waiting on nothing.
            let frames = ActivityClock()

            let reader = Task {
                do {
                    let body = ChunkedBody(configuration: configuration)
                    // Every exit closes the connection — a response rejected
                    // below is never read, so nothing else would.
                    defer { body.cancel() }
                    let response = try await body.start(request)
                    guard let http = response as? HTTPURLResponse else {
                        throw Failure.notEventStream(nil)
                    }
                    guard (200..<300).contains(http.statusCode) else {
                        var text = Data()
                        for try await chunk in body.chunks { text += chunk; if text.count > 4000 { break } }
                        let message = String(decoding: text, as: UTF8.self)
                        throw Failure.badStatus(http.statusCode, body: message.isEmpty ? nil : message)
                    }
                    let contentType = http.value(forHTTPHeaderField: "Content-Type") ?? ""
                    guard contentType.contains("text/event-stream") else {
                        throw Failure.notEventStream(contentType)
                    }

                    var pending = SSEEvent(data: "")
                    var hasData = false
                    var buffer: [UInt8] = []
                    buffer.reserveCapacity(4096)

                    // Split on newlines by hand: `AsyncLineSequence` drops the
                    // blank lines that delimit SSE events.
                    func consume(_ rawLine: [UInt8]) {
                        var line = String(decoding: rawLine, as: UTF8.self)
                        if line.hasSuffix("\r") { line.removeLast() }
                        if line.isEmpty {
                            if hasData { frames.touch(); continuation.yield(pending) }
                            pending = SSEEvent(data: "")
                            hasData = false
                            return
                        }
                        if line.hasPrefix(":") { return } // heartbeat / comment

                        let (field, value) = split(line)
                        switch field {
                        case "data":
                            pending.data += (hasData ? "\n" : "") + value
                            hasData = true
                        case "event": pending.event = value
                        case "id": pending.id = value
                        default: break
                        }
                    }

                    for try await chunk in body.chunks {
                        activity.touch()
                        var start = chunk.startIndex
                        while let newline = chunk[start...].firstIndex(of: UInt8(ascii: "\n")) {
                            buffer.append(contentsOf: chunk[start..<newline])
                            consume(buffer)
                            buffer.removeAll(keepingCapacity: true)
                            start = newline + 1
                        }
                        buffer.append(contentsOf: chunk[start...])
                    }
                    if !buffer.isEmpty { consume(buffer) }
                    if hasData { continuation.yield(pending) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }

            // Watchdog: first byte within `firstByteTimeout`, then no gap
            // longer than `idleTimeout` (the backend heartbeats every ~5 s).
            let watchdog = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    let (seen, idle) = activity.status()
                    if !seen, idle > firstByteTimeout {
                        continuation.finish(throwing: Failure.firstByteTimeout)
                        reader.cancel()
                        return
                    }
                    if seen, idle > idleTimeout {
                        continuation.finish(throwing: Failure.idleTimeout)
                        reader.cancel()
                        return
                    }
                    let (sawFrame, sinceFrame) = frames.status()
                    if sawFrame, sinceFrame > frameTimeout {
                        continuation.finish(throwing: Failure.frameTimeout)
                        reader.cancel()
                        return
                    }
                }
            }

            continuation.onTermination = { _ in
                reader.cancel()
                watchdog.cancel()
            }
        }
    }

    /// A response body in the chunks the network delivers. `URLSession.bytes`
    /// hands it over one awaited byte at a time — about 120 KB/s even in an
    /// optimized build — so a replayed turn carrying megabytes of tool output
    /// took seconds to arrive and played back on screen.
    private final class ChunkedBody: NSObject, URLSessionDataDelegate, @unchecked Sendable {
        let chunks: AsyncThrowingStream<Data, Error>
        private let sink: AsyncThrowingStream<Data, Error>.Continuation
        private let lock = NSLock()
        private var waiter: CheckedContinuation<URLResponse, Error>?
        private var task: URLSessionDataTask?
        private let configuration: URLSessionConfiguration

        init(configuration: URLSessionConfiguration) {
            self.configuration = configuration
            (chunks, sink) = AsyncThrowingStream<Data, Error>.makeStream()
            super.init()
            sink.onTermination = { [weak self] _ in self?.cancel() }
        }

        func start(_ request: URLRequest) async throws -> URLResponse {
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
                    let task = session.dataTask(with: request)
                    lock.withLock { waiter = continuation; self.task = task }
                    task.resume()
                    session.finishTasksAndInvalidate()
                    if Task.isCancelled { task.cancel() }
                }
            } onCancel: {
                cancel()
            }
        }

        func cancel() { lock.withLock { task }?.cancel() }

        private func takeWaiter() -> CheckedContinuation<URLResponse, Error>? {
            lock.withLock { defer { waiter = nil }; return waiter }
        }

        func urlSession(
            _: URLSession, dataTask _: URLSessionDataTask, didReceive response: URLResponse,
            completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
        ) {
            takeWaiter()?.resume(returning: response)
            completionHandler(.allow)
        }

        func urlSession(_: URLSession, dataTask _: URLSessionDataTask, didReceive data: Data) {
            sink.yield(data)
        }

        func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: Error?) {
            takeWaiter()?.resume(throwing: error ?? URLError(.badServerResponse))
            if let error { sink.finish(throwing: error) } else { sink.finish() }
        }
    }

    /// Last-byte timestamp shared between the reader and the watchdog.
    private final class ActivityClock: @unchecked Sendable {
        private let lock = NSLock()
        private var last = ContinuousClock.now
        private var seen = false

        func touch() {
            lock.withLock { last = .now; seen = true }
        }

        func status() -> (seen: Bool, idle: Duration) {
            lock.withLock { (seen, ContinuousClock.now - last) }
        }
    }

    private static func split(_ line: String) -> (String, String) {
        guard let colon = line.firstIndex(of: ":") else { return (line, "") }
        let field = String(line[..<colon])
        var value = String(line[line.index(after: colon)...])
        if value.hasPrefix(" ") { value.removeFirst() }
        return (field, value)
    }

    static func errorMessage(in body: String) -> String? {
        guard let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return body.isEmpty ? nil : body }
        if let error = json["error"] as? [String: Any], let message = error["message"] as? String { return message }
        if let message = json["message"] as? String { return message }
        return body
    }
}
