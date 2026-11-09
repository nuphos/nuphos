import Foundation

@main struct SavedAccountsTests {
    static func main() throws {
        var disk: String?
        var failWrite = false
        let store = SavedAccounts(read: { disk }, write: { value in
            if failWrite { throw URLError(.cannotWriteToFile) }
            disk = value
        })
        let alice = NuphosUser(id: "alice", email: "a@example.com", name: "Alice", username: "", avatarURL: "")
        let bob = NuphosUser(id: "bob", email: "b@example.com", name: "Bob", username: "", avatarURL: "")
        try store.save(user: alice, token: "alice-secret", origin: "https://api.nuphos.ai")
        let aliceID = store.active!.id
        precondition(store.acceptsNotification(accountID: "alice"))
        precondition(!store.acceptsNotification(accountID: "bob"))
        try store.save(user: bob, token: "bob-secret", origin: "https://api.nuphos.ai")
        let bobID = store.active!.id
        precondition(store.accounts.count == 2)
        precondition(!store.acceptsNotification(accountID: nil))
        precondition(store.acceptsNotification(accountID: "bob"))
        precondition(!store.acceptsNotification(accountID: "alice"))
        try store.select(aliceID)
        precondition(store.active?.token == "alice-secret")
        failWrite = true
        do { try store.select(bobID); preconditionFailure("write must fail") } catch {}
        precondition(store.active?.id == aliceID)
        failWrite = false
        try store.invalidate(bobID)
        precondition(store.active?.id == aliceID)
        precondition(store.accounts.first { $0.id == bobID }?.token == nil)
        try store.remove(bobID)
        precondition(store.accounts.count == 1)
        try store.save(user: alice, token: "other-secret", origin: "https://self.example.com")
        precondition(store.accounts.count == 2)
        let restored = SavedAccounts(read: { disk }, write: { disk = $0 })
        precondition(!restored.acceptsNotification(accountID: "alice"))
        precondition(restored.active?.origin == "https://self.example.com")
        precondition(restored.active?.token == "other-secret")
        try restored.remove(restored.active!.id)
        precondition(restored.active == nil)
        precondition(restored.accounts.count == 1)
        precondition(restored.hasRegistry)
        let broken = SavedAccounts(read: { "not valid JSON" }, write: { _ in preconditionFailure("corrupt data must not be overwritten") })
        precondition(broken.error != nil)
        do { try broken.save(user: alice, token: "synthetic", origin: "https://api.nuphos.ai"); preconditionFailure("must refuse overwrite") } catch {}
        let locked = SavedAccounts(read: { throw URLError(.noPermissionsToReadFile) }, write: { _ in preconditionFailure("locked data must not be overwritten") })
        precondition(locked.error != nil)
        do { try locked.save(user: alice, token: "synthetic", origin: "https://api.nuphos.ai"); preconditionFailure("must refuse overwrite") } catch {}
        print("Saved account registry tests passed")
    }
}
