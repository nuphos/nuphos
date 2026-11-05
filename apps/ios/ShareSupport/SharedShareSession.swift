import Foundation
import Security

/// One authenticated handoff, never message/draft storage. The complete value
/// lives only in a provisioned Keychain access group shared by these two targets.
enum SharedShareSession {
    struct Context: Codable, Equatable, Sendable {
        var teamID: String
        var runtimeID: String?
        var credentials: JSONValue?
        var permissionMode: String
    }
    struct Record: Codable, Sendable {
        var loginID: UUID
        var leaseID: UUID
        var token: String
        var accountID: String
        var backend: URL
        var context: Context?
    }
    enum Failure: LocalizedError {
        case unavailable, signedOut, changed, workspace, identity
        case keychain(OSStatus)
        var errorDescription: String? {
            switch self {
            case .unavailable: "Shared sign-in is unavailable. Open Nuphos and sign in; both targets require matching shared Keychain provisioning."
            case .signedOut: "Open Nuphos and sign in before sharing."
            case .changed: "Your account or workspace changed. Cancel this share and share again. Nothing else will be sent."
            case .workspace: "Open Nuphos and select the workspace for this share."
            case .keychain(let status): "Shared Keychain access failed (\(status)). Both App IDs and profiles need the same shared Keychain group."
            case .identity: "The shared sign-in no longer matches this account. Sign in again in Nuphos."
            }
        }
    }
    private static var group: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "NuphosSharedKeychainGroup") as? String,
              !value.isEmpty, !value.contains("$("), value.hasSuffix(".ai.nuphos.ios.shared-auth") else { return nil }
        return value
    }
    #if SHARE_SESSION_INTEGRATION_TESTS
    // Test executable only: never query or mutate the application's live service.
    static var beforeContextWrite: (() -> Void)?
    #endif
    private static func query() throws -> [String: Any] {
        #if SHARE_SESSION_INTEGRATION_TESTS
        let service = ProcessInfo.processInfo.arguments[1]
        precondition(service.hasPrefix("ai.nuphos.ios.share-session.integration."))
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service, kSecAttrAccount as String: "synthetic-only"]
        #else
        guard let group else { throw Failure.unavailable }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "ai.nuphos.ios.share-session",
                kSecAttrAccount as String: "current",
                kSecAttrAccessGroup as String: group]
        #endif
    }
    static func read() throws -> Record? {
        var q = try query(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw Failure.keychain(status) }
        return try JSONDecoder().decode(Record.self, from: data)
    }
    /// A containing-app store captures one login. Only an explicit verified
    /// publication may rebind the active store; other old stores stay fenced.
    struct Owner {
        let token: String
        private(set) var loginID: UUID?
        init(token: String) {
            self.token = token
            loginID = (try? SharedShareSession.read()).flatMap { $0.token == token ? $0.loginID : nil }
        }
        mutating func bindVerified(_ id: UUID) -> Bool {
            guard let record = try? SharedShareSession.read(), record.token == token, record.loginID == id else { return false }
            loginID = id
            return true
        }
        func update(_ context: Context) {
            SharedShareSession.updateContext(token: token, loginID: loginID, context: context)
        }
    }
    @discardableResult
    static func publishLogin(token: String, accountID: String, backend: URL) throws -> UUID {
        let record = Record(loginID: UUID(), leaseID: UUID(), token: token, accountID: accountID, backend: backend)
        let q = try query()
        let values: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(record),
            kSecAttrGeneric as String: Data(record.leaseID.uuidString.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let update = SecItemUpdate(q as CFDictionary, values as CFDictionary)
        if update == errSecSuccess { return record.loginID }
        guard update == errSecItemNotFound,
              SecItemAdd(q.merging(values) { $1 } as CFDictionary, nil) == errSecSuccess else { throw Failure.unavailable }
        return record.loginID
    }
    /// Conditional Keychain update: stale stores cannot resurrect a deleted login
    /// or overwrite another login/context written between read and update.
    static func updateContext(token: String, loginID: UUID?, context: Context) {
        guard let loginID, var record = try? read(), record.token == token,
              record.loginID == loginID, record.context != context else { return }
        #if SHARE_SESSION_INTEGRATION_TESTS
        beforeContextWrite?()
        #endif
        let oldLease = record.leaseID; record.leaseID = UUID(); record.context = context
        guard var q = try? query(), let data = try? JSONEncoder().encode(record) else { return }
        q[kSecAttrGeneric as String] = Data(oldLease.uuidString.utf8)
        let values: [String: Any] = [kSecValueData as String: data, kSecAttrGeneric as String: Data(record.leaseID.uuidString.utf8)]
        SecItemUpdate(q as CFDictionary, values as CFDictionary)
    }
    static func revoke() {
        guard let q = try? query() else { return }
        SecItemDelete(q as CFDictionary)
    }
    static func matches(_ current: Record?, lease: Record) -> Bool {
        guard let current else { return false }
        return current.loginID == lease.loginID && current.leaseID == lease.leaseID
            && current.accountID == lease.accountID && current.backend == lease.backend
            && current.context == lease.context && current.token == lease.token
    }
    static func validate(_ lease: Record) throws {
        guard matches(try read(), lease: lease) else { throw Failure.changed }
    }
}
