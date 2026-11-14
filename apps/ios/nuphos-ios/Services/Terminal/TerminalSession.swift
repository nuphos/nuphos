import Foundation
import Observation

/// A shell on the computer a conversation runs on, as the Mac's Runtime terminal tab opens it:
/// the backend's runtime terminal socket, which keeps the computer's own terminal permission.
/// The phone shows what the shell prints and sends what is typed.
@Observable
final class TerminalSession {
    enum Phase: Equatable {
        case connecting
        /// Open, with the computer's name.
        case live(String)
        case ended
        case failed(String)
    }

    let teamId: String
    let sessionId: String
    private let token: String

    private(set) var phase = Phase.connecting
    /// Output for the terminal view, which feeds itself rather than being observed.
    @ObservationIgnored var onOutput: (([UInt8]) -> Void)?
    /// The latest output, for a view made after it arrived, as the Mac's terminal keeps it.
    @ObservationIgnored private(set) var scrollback: [UInt8] = []
    @ObservationIgnored private var socket: URLSessionWebSocketTask?
    @ObservationIgnored private var runTask: Task<Void, Never>?
    @ObservationIgnored private var size = (cols: 80, rows: 24)

    init(teamId: String, sessionId: String, token: String) {
        self.teamId = teamId
        self.sessionId = sessionId
        self.token = token
    }

    func start() {
        guard runTask == nil else { return }
        phase = .connecting
        scrollback = []
        runTask = Task { await run() }
    }

    /// Closing the socket ends the shell on the computer.
    func stop() {
        runTask?.cancel()
        runTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    func retry() {
        stop()
        start()
    }

    /// What was typed. The backend takes at most 16 KB a frame, so a long paste goes in pieces.
    func input(_ bytes: ArraySlice<UInt8>) {
        guard case .live = phase else { return }
        var text = Substring(String(decoding: bytes, as: UTF8.self))
        while !text.isEmpty {
            let piece = text.prefix(4096)
            send(["type": "input", "data": String(piece)])
            text = text.dropFirst(piece.count)
        }
    }

    func resize(cols: Int, rows: Int) {
        guard cols > 1, rows > 1, (cols, rows) != size else { return }
        size = (cols, rows)
        if case .live = phase { send(["type": "resize", "cols": cols, "rows": rows]) }
    }

    private struct Frame: Decodable {
        let type: String
        var data: String?
        var sequence: Int?
        var label: String?
        var message: String?
    }

    private struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private func run() async {
        do {
            try await connect()
            phase = .ended
        } catch {
            guard !Task.isCancelled else { return }
            if case .live = phase {
                phase = .ended
            } else {
                phase = .failed((error as? Failure)?.message ?? Self.refusal(socket?.response))
            }
        }
    }

    private func connect() async throws {
        var components = URLComponents(url: NuphosAPI.baseURL(for: token).appending(path: "teams/\(teamId)/runtime-terminal/\(sessionId)"), resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.queryItems = [
            URLQueryItem(name: "cols", value: String(size.cols)),
            URLQueryItem(name: "rows", value: String(size.rows)),
        ]
        var request = URLRequest(url: components.url!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(AccountAPI.aiConsentVersion, forHTTPHeaderField: "x-nuphos-ai-consent-version")
        let socket = URLSession.shared.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        defer { socket.cancel(with: .goingAway, reason: nil) }

        while !Task.isCancelled {
            guard case .string(let text) = try await socket.receive(),
                  let frame = try? JSONDecoder().decode(Frame.self, from: Data(text.utf8))
            else { throw Failure(message: "The terminal sent something it couldn't read.") }
            switch frame.type {
            case "ready":
                phase = .live(frame.label ?? "Runtime")
                // The view may have laid out at another size while this connected.
                send(["type": "resize", "cols": size.cols, "rows": size.rows])
            case "data":
                if let data = frame.data.flatMap({ Data(base64Encoded: $0) }) {
                    scrollback.append(contentsOf: data)
                    if scrollback.count > 256 << 10 { scrollback.removeFirst(scrollback.count - (256 << 10)) }
                    onOutput?(Array(data))
                }
                if let sequence = frame.sequence { send(["type": "ack", "sequence": sequence]) }
            case "error":
                throw Failure(message: frame.message ?? "Could not connect to the runtime terminal.")
            case "exit":
                return
            default:
                break
            }
        }
    }

    private func send(_ frame: [String: Any]) {
        guard let socket, let data = try? JSONSerialization.data(withJSONObject: frame) else { return }
        socket.send(.string(String(decoding: data, as: UTF8.self))) { _ in }
    }

    /// Why the backend refused the socket before it opened.
    private static func refusal(_ response: URLResponse?) -> String {
        switch (response as? HTTPURLResponse)?.statusCode {
        case 403: "Only people who manage this computer can open a terminal on it."
        case 404: "This conversation has no computer to open a terminal on."
        case 503: "This conversation's computer is offline."
        default: "Could not connect to the runtime terminal."
        }
    }
}
