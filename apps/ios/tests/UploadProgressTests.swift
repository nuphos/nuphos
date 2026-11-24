import Foundation
import Network

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// A store that stops reading a body after its first bytes until it is let go,
/// so an upload is caught in flight. URLProtocol stubs never report sent bytes,
/// so this is a real socket on the loopback interface.
private nonisolated final class StalledStore: @unchecked Sendable {
    private let listener = try! NWListener(using: .tcp, on: .any)
    private let queue = DispatchQueue(label: "stalled-store")
    private var connection: NWConnection?
    private var received = 0
    private var head: Data?
    private let headStart = 64 * 1024
    private var released = false

    var port: UInt16 { listener.port!.rawValue }

    func start() async {
        await withCheckedContinuation { (ready: CheckedContinuation<Void, Never>) in
            listener.stateUpdateHandler = { if case .ready = $0 { ready.resume() } }
            listener.newConnectionHandler = { [self] connection in
                self.connection = connection
                received = 0
                head = Data()
                released = false
                connection.start(queue: queue)
                read()
            }
            listener.start(queue: queue)
        }
    }

    /// Reads what the upload has sent, then lets it finish with a 200.
    func release(expecting bytes: Int) {
        queue.async { [self] in
            released = true
            read(until: bytes)
        }
    }

    private func read(until bytes: Int? = nil) {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [self] data, _, _, _ in
            received += data?.count ?? 0
            // Count the body only: drop the request head once it has arrived.
            if head != nil, let data {
                head!.append(data)
                if let end = head!.range(of: Data("\r\n\r\n".utf8)) {
                    received = head!.count - end.upperBound
                    head = nil
                }
            }
            if let bytes, head == nil, received >= bytes {
                let reply = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                connection?.send(content: Data(reply.utf8), completion: .contentProcessed { _ in })
            } else if released || received < headStart {
                read(until: bytes)
            }
        }
    }
}

/// The sending bubble reads the message's completedUnitCount; it must count
/// bytes while a file is still going out, not only once it is done.
@main
enum UploadProgressTests {
    static func main() async {
        let store = StalledStore()
        await store.start()
        let sizes = [8 * 1024 * 1024, 4 * 1024 * 1024]
        let progress = Progress()
        progress.totalUnitCount = Int64(sizes.reduce(0, +))
        var sent: Int64 = 0
        for (index, size) in sizes.enumerated() {
            var request = URLRequest(url: URL(string: "http://127.0.0.1:\(store.port)/upload")!)
            request.httpMethod = "PUT"
            let tracker = UploadProgress(progress: progress, offset: sent)
            let upload = Task { try await URLSession.shared.upload(for: request, from: Data(count: size), delegate: tracker) }
            var inFlight: Int64 = 0
            for _ in 0..<100 where inFlight <= sent {
                try? await Task.sleep(for: .milliseconds(50))
                inFlight = progress.completedUnitCount
            }
            check(inFlight > sent && inFlight < sent + Int64(size),
                  "file \(index + 1) is in flight but the message reports \(inFlight) of \(progress.totalUnitCount) bytes")
            print("file \(index + 1) in flight: \(inFlight) of \(progress.totalUnitCount)")
            store.release(expecting: size)
            guard let (_, response) = try? await upload.value, (response as? HTTPURLResponse)?.statusCode == 200 else {
                check(false, "file \(index + 1) did not upload"); return
            }
            sent += Int64(size)
        }
        check(progress.completedUnitCount == progress.totalUnitCount,
              "every byte is out but the message reports \(progress.completedUnitCount) of \(progress.totalUnitCount)")
        print("Upload progress passed")
    }
}
