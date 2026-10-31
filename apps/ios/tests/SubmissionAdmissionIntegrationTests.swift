import Foundation

@MainActor private final class HeldUpload {
    var continuation: CheckedContinuation<Void, Never>?
    func run() async { await withCheckedContinuation { continuation = $0 } }
    func waitUntilHeld() async { while continuation == nil { await Task.yield() } }
    func release() { continuation?.resume(); continuation = nil }
}

@main struct SubmissionAdmissionIntegrationTests {
    @MainActor static func main() async throws {
        SharedShareSession.revoke()
        defer { SharedShareSession.revoke() }
        for scenario in ["scope-change", "logout", "cancel", "unchanged"] {
            try SharedShareSession.publishLogin(token: "synthetic-only", accountID: "synthetic-account", backend: URL(string: "https://example.invalid")!)
            let lease = try SharedShareSession.read()!
            let upload = HeldUpload()
            var posts = 0
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let attachment = directory.appendingPathComponent("synthetic.txt")
            try Data("synthetic-only".utf8).write(to: attachment)
            let job = Task { @MainActor in
                defer { try? FileManager.default.removeItem(at: directory) }
                do {
                    try await SubmissionAdmission.prepare(check: { try SharedShareSession.validate(lease) }) {
                        await upload.run() // deliberately ignores task cancellation
                    }
                    posts += 1 // transport spy: no network in this executable
                    return true
                } catch { return false }
            }
            await upload.waitUntilHeld()
            if scenario == "scope-change" {
                let context = SharedShareSession.Context(teamID: "other-synthetic-team", runtimeID: nil, credentials: nil, permissionMode: "auto")
                SharedShareSession.updateContext(token: lease.token, loginID: lease.loginID, context: context)
            } else if scenario == "logout" { SharedShareSession.revoke() }
            else if scenario == "cancel" { job.cancel() }
            upload.release()
            let admitted = await job.value
            precondition(admitted == (scenario == "unchanged"))
            precondition(posts == (scenario == "unchanged" ? 1 : 0))
            precondition(!FileManager.default.fileExists(atPath: attachment.path))
            print("PASS: held upload \(scenario), post count \(posts), synthetic attachment cleanup")
        }
    }
}
