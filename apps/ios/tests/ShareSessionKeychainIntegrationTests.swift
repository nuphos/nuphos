import Foundation

/// Uses actual SecItem operations in a UUID-namespaced service, never app auth.
@main struct ShareSessionKeychainIntegrationTests {
    static let context = SharedShareSession.Context(teamID: "synthetic-team", runtimeID: "synthetic-runtime", credentials: .object([:]), permissionMode: "auto")
    static func login() throws {
        try SharedShareSession.publishLogin(token: "synthetic-only", accountID: "synthetic-account", backend: URL(string: "https://example.invalid")!)
    }
    static func wait(_ url: URL) throws {
        let deadline = Date().addingTimeInterval(10)
        while !FileManager.default.fileExists(atPath: url.path) {
            guard Date() < deadline else { throw NSError(domain: "KeychainTestTimeout", code: 1) }
            Thread.sleep(forTimeInterval: 0.01)
        }
    }
    static func main() throws {
        let args = ProcessInfo.processInfo.arguments
        precondition(args.count >= 2)
        if args.count == 5 && args[2] == "stale-writer" {
            let lease = try SharedShareSession.read()!
            SharedShareSession.beforeContextWrite = {
                do {
                    try Data().write(to: URL(fileURLWithPath: args[3]))
                    try wait(URL(fileURLWithPath: args[4]))
                } catch { fatalError("Synthetic barrier failed") }
            }
            SharedShareSession.updateContext(token: lease.token, loginID: lease.loginID, context: context)
            return
        }
        SharedShareSession.revoke()
        defer { SharedShareSession.revoke() }
        try login()
        let first = try SharedShareSession.read()!
        SharedShareSession.updateContext(token: first.token, loginID: first.loginID, context: context)
        let configured = try SharedShareSession.read()!
        precondition(configured.context == context && configured.leaseID != first.leaseID)
        print("PASS: actual Keychain context update rotates lease")
        // Cached Home can construct a store while server verification is held.
        // Reconcile only the active store after the verified login publication.
        for hasPreviousLogin in [false, true] {
            SharedShareSession.revoke()
            if hasPreviousLogin { try login() }
            var active = SharedShareSession.Owner(token: "synthetic-only")
            let stale = SharedShareSession.Owner(token: "synthetic-only")
            let verifiedID = try SharedShareSession.publishLogin(token: "synthetic-only", accountID: "synthetic-account", backend: URL(string: "https://example.invalid")!)
            precondition(active.bindVerified(verifiedID))
            active.update(context)
            let rebound = try SharedShareSession.read()!
            precondition(rebound.context == context)
            try login() // A genuinely different login, even with the same token.
            let differentLogin = try SharedShareSession.read()!
            stale.update(context)
            active.update(context)
            let afterStale = try SharedShareSession.read()
            precondition(SharedShareSession.matches(afterStale, lease: differentLogin))
            precondition(!active.bindVerified(verifiedID))
        }
        print("PASS: cached store rebind publishes selected context; stale stores cannot overwrite another login")
        for action in ["relogin", "revoke", "context-change"] {
            try login()
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let ready = directory.appendingPathComponent("ready"), release = directory.appendingPathComponent("release")
            let writer = Process()
            writer.executableURL = URL(fileURLWithPath: args[0])
            writer.arguments = [args[1], "stale-writer", ready.path, release.path]
            try writer.run()
            try wait(ready)
            if action == "relogin" { try login() }
            else if action == "revoke" { SharedShareSession.revoke() }
            else {
                let current = try SharedShareSession.read()!
                var changed = context; changed.teamID = "other-synthetic-team"
                SharedShareSession.updateContext(token: current.token, loginID: current.loginID, context: changed)
            }
            let expected = try SharedShareSession.read()
            try Data().write(to: release)
            writer.waitUntilExit()
            precondition(writer.terminationStatus == 0)
            let actual = try SharedShareSession.read()
            if let expected { precondition(SharedShareSession.matches(actual, lease: expected)) }
            else { precondition(actual == nil) }
            print("PASS: actual cross-process stale SecItemUpdate rejected after \(action)")
        }
    }
}
