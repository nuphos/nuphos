import Foundation
import Observation

struct SavedAccount: Codable, Identifiable, Equatable {
    let origin: String
    var user: NuphosUser
    var token: String?
    var id: String { "\(origin)|\(user.id)" }
}

/// The whole registry is one secure write, so a failed save cannot partially switch identity.
@Observable final class SavedAccounts {
    private struct Registry: Codable {
        var accounts: [SavedAccount] = []
        var activeID: String?
    }

    static let key = "saved-accounts-v1"
    private var registry = Registry()
    private(set) var hasRegistry = false
    private(set) var error: String?
    private let write: (String) throws -> Void
    var accounts: [SavedAccount] { registry.accounts }
    var active: SavedAccount? { guard error == nil else { return nil }; return accounts.first { $0.id == registry.activeID } }

    init(read: () throws -> String? = { try Keychain.load(key) }, write: @escaping (String) throws -> Void = { try Keychain.write($0, for: key) }) {
        self.write = write
        do {
            if let raw = try read() {
                registry = try JSONDecoder().decode(Registry.self, from: Data(raw.utf8))
                hasRegistry = true
            }
        } catch { self.error = "Saved accounts could not be read. Try again before adding an account." }
        for account in registry.accounts {
            if let token = account.token, !NuphosAPI.rememberOrigin(account.origin, token: token) {
                error = "This session is saved for more than one server. Sign in with a fresh session."
            }
        }
    }

    func acceptsNotification(accountID: String?) -> Bool {
        guard let active, active.token != nil else { return false }
        guard let accountID else { return accounts.count == 1 }
        return active.user.id == accountID && accounts.filter { $0.user.id == accountID }.count == 1
    }

    func save(user: NuphosUser, token: String, origin: String) throws {
        guard NuphosAPI.rememberOrigin(origin, token: token),
              !accounts.contains(where: { $0.token == token && ($0.origin != origin || $0.user.id != user.id) })
        else { throw URLError(.userAuthenticationRequired) }
        let account = SavedAccount(origin: origin, user: user, token: token)
        var next = registry
        if let index = next.accounts.firstIndex(where: { $0.id == account.id }) { next.accounts[index] = account }
        else { next.accounts.append(account) }
        next.activeID = account.id
        try commit(next)
    }

    func select(_ id: String) throws {
        guard accounts.contains(where: { $0.id == id && $0.token != nil }) else { throw URLError(.userAuthenticationRequired) }
        var next = registry
        next.activeID = id
        try commit(next)
    }

    func invalidate(_ id: String) throws {
        var next = registry
        if let index = next.accounts.firstIndex(where: { $0.id == id }) { next.accounts[index].token = nil }
        if next.activeID == id { next.activeID = nil }
        try commit(next)
    }

    func remove(_ id: String) throws {
        var next = registry
        next.accounts.removeAll { $0.id == id }
        if next.activeID == id { next.activeID = nil }
        try commit(next)
    }

    private func commit(_ next: Registry) throws {
        guard error == nil else { throw URLError(.cannotDecodeContentData) }
        try write(String(decoding: JSONEncoder().encode(next), as: UTF8.self))
        registry = next
        hasRegistry = true
    }
}
