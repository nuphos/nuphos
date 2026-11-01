import Foundation

/// The launch check opens Home from the cache and asks `/auth/me` behind it,
/// so its answer can arrive after the user has signed out or in again.
@main struct AuthSessionTests {
    static func main() async {
        await aLateRejectionKeepsANewSignIn()
        await aLateRejectionAfterSignOutStaysSignedOut()
        await aLateFailureAfterSignOutShowsNoError()
        await aLateAnswerAfterSignOutStaysSignedOut()
        print("Auth session launch check passed")
    }

    private static let cached = NuphosUser(id: "u-old", email: "", name: "Old", username: "", avatarURL: "")

    /// Starts a launch with a saved token and a cached user; the returned
    /// closure answers its `/auth/me`.
    private static func launch(_ session: AuthSession) async -> (Result<NuphosUser, Error>) -> Void {
        Keychain.items = [AuthSession.tokenKey: "old"]
        LaunchCache.user = .init(user: cached, aiConsentVersion: AccountAPI.aiConsentVersion)
        var answer: CheckedContinuation<NuphosUser, Error>?
        NuphosAPI.me = { token in
            guard token == "old" else { return NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "") }
            return try await withCheckedThrowingContinuation { answer = $0 }
        }
        Task { await session.restore() }
        while answer == nil { await Task.yield() }
        precondition(session.state == .signedIn(cached)) // Home is open from the cache.
        return { answer?.resume(with: $0) }
    }

    private static func settle() async {
        for _ in 0..<100 { await Task.yield() }
    }

    private static func aLateRejectionKeepsANewSignIn() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        AccountAPI.signInToken = "new"
        try? await session.emailSignIn(email: "a@example.com", credential: "123456", password: false)
        precondition(session.token == "new")
        reply(.failure(NuphosAPI.Failure.unauthorized))
        await settle()
        precondition(session.token == "new")
        precondition(Keychain.items[AuthSession.tokenKey] == "new")
        precondition(session.user?.id == "u-new")
    }

    private static func aLateRejectionAfterSignOutStaysSignedOut() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        precondition(LaunchCache.user == nil)
        reply(.failure(NuphosAPI.Failure.unauthorized))
        await settle()
        precondition(session.state == .signedOut(error: nil))
    }

    private static func aLateFailureAfterSignOutShowsNoError() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        reply(.failure(URLError(.notConnectedToInternet)))
        await settle()
        precondition(session.state == .signedOut(error: nil))
    }

    private static func aLateAnswerAfterSignOutStaysSignedOut() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        reply(.success(cached))
        await settle()
        precondition(session.state == .signedOut(error: nil))
        precondition(session.user == nil)
    }
}
