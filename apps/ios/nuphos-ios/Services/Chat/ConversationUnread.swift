import Foundation
import Observation

/// Server-authoritative read receipts. The backend counts assistant turn
/// boundaries (`activitySeq`) and keeps the owner's read marker (`readSeq`)
/// across all of their devices; this renders from those and advances the
/// marker only to what an on-screen conversation has fetched.
@Observable
final class ConversationUnread {
    struct Marker: Equatable { var activity: Int; var read: Int }
    typealias MarkRead = @MainActor (_ team: String, _ session: String, _ seq: Int) async -> Marker?
    typealias Probe = @MainActor (_ team: String, _ session: String) async -> Void

    static let shared = ConversationUnread()
    private final class Weak { weak var value: ConversationUnread?; init(_ value: ConversationUnread) { self.value = value } }
    private static var accounts: [String: Weak] = [:]

    static func forAccount(_ token: String) -> ConversationUnread {
        if let existing = accounts[token]?.value { return existing }
        accounts = accounts.filter { $0.value.value != nil }
        let value = ConversationUnread()
        accounts[token] = Weak(value)
        return value
    }
    private(set) var markers: [String: Marker] = [:]
    private var displayed: [String: Int] = [:]
    private var pending: [String: Int] = [:]
    private var readers: [UUID: String] = [:]
    @ObservationIgnored var markRead: MarkRead?
    @ObservationIgnored var probe: Probe?

    private func key(_ team: String, _ session: String) -> String { "\(team)/\(session)" }
    private func isReading(_ key: String) -> Bool { readers.values.contains(key) }
    func isReading(team: String, session: String) -> Bool { isReading(key(team, session)) }

    func contains(team: String, session: String) -> Bool {
        let value = key(team, session)
        guard let marker = markers[value], !isReading(value) else { return false }
        return marker.activity > max(marker.read, pending[value] ?? 0)
    }

    /// `displayed` means the values arrived with the transcript a view shows.
    func receive(team: String, session: String, activity: Int?, read: Int?, displayed isDisplayed: Bool) {
        guard let activity else { return }
        let value = key(team, session)
        let current = markers[value] ?? Marker(activity: 0, read: 0)
        let next = Marker(activity: max(current.activity, activity), read: max(current.read, read ?? 0))
        if next != current { markers[value] = next }
        guard isDisplayed else { return }
        displayed[value] = max(displayed[value] ?? 0, activity)
        flush(team: team, session: session)
    }

    func setReading(_ reading: Bool, reader: UUID, team: String, session: String) {
        readers[reader] = reading ? key(team, session) : nil
        if reading { flush(team: team, session: session) }
    }

    /// A turn ended here. An on-screen conversation fetches its new marker right away.
    func observe(team: String, session: String, turn _: String) {
        guard isReading(key(team, session)), let probe else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(750))
            await probe(team, session)
        }
    }

    /// The marker to send for an on-screen conversation, if it has shown anything newer.
    func claimRead(team: String, session: String) -> Int? {
        let value = key(team, session)
        guard isReading(value), let target = displayed[value],
              target > max(markers[value]?.read ?? 0, pending[value] ?? 0) else { return nil }
        pending[value] = target
        return target
    }

    /// A failed request (`nil`) releases the claim so the next transcript fetch retries.
    func confirm(team: String, session: String, target: Int, _ confirmed: Marker?) {
        let value = key(team, session)
        if pending[value] == target { pending[value] = nil }
        if let confirmed { receive(team: team, session: session, activity: confirmed.activity, read: confirmed.read, displayed: false) }
    }

    private func flush(team: String, session: String) {
        guard let markRead, let target = claimRead(team: team, session: session) else { return }
        Task { confirm(team: team, session: session, target: target, await markRead(team, session, target)) }
    }
}
