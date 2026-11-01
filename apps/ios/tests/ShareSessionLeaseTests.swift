import Foundation

@main struct ShareSessionLeaseTests {
    static func main() {
        let context = SharedShareSession.Context(teamID: "test-team", runtimeID: "test-runtime", credentials: .object([:]), permissionMode: "auto")
        let original = SharedShareSession.Record(loginID: UUID(), leaseID: UUID(), token: "synthetic-test-only", accountID: "test-account", backend: URL(string: "https://example.invalid")!, context: context)
        precondition(SharedShareSession.matches(original, lease: original))
        precondition(!SharedShareSession.matches(nil, lease: original))
        var changed = original; changed.loginID = UUID()
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.leaseID = UUID()
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.accountID = "other-account"
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.backend = URL(string: "https://other.invalid")!
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.token = "other-synthetic-test-token"
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.context?.teamID = "other-team"
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.context?.runtimeID = "other-runtime"
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.context?.permissionMode = "bypass"
        precondition(!SharedShareSession.matches(changed, lease: original))
        changed = original; changed.context?.credentials = .object(["test": .string("different")])
        precondition(!SharedShareSession.matches(changed, lease: original))
        print("PASS: stable share lease; logout, relogin, epoch, account, backend, token, workspace, Runtime, permission and credential isolation")
    }
}
