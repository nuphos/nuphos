import Foundation

/// The launch check opens Home from the cache and asks `/auth/me` behind it,
/// so its answer can arrive after the user has signed out or in again.
@main @MainActor struct AuthSessionTests {
    static func main() async {
        await aCachedHomeReceivesVerifiedSharingOwner()
        await aLateRejectionKeepsANewSignIn()
        await aLateSuccessKeepsANewSharedSignIn()
        await aLateRejectionAfterSignOutStaysSignedOut()
        await aLateFailureAfterSignOutShowsNoError()
        await aLateAnswerAfterSignOutStaysSignedOut()
        print("Auth session launch check passed")
    }

    private static let cached = NuphosUser(id: "u-old", email: "", name: "Old", username: "", avatarURL: "")

    /// Starts a launch with a saved token and a cached user; the returned
    /// closure answers its `/auth/me`.
    private static func launch(_ session: AuthSession) async -> (Result<NuphosUser, Error>) async -> Void {
        SharedShareSession.publishedToken = nil
        Keychain.items = [AuthSession.tokenKey: "old"]
        LaunchCache.user = .init(user: cached, aiConsentVersion: AccountAPI.aiConsentVersion)
        var answer: CheckedContinuation<NuphosUser, Error>?
        NuphosAPI.me = { token in
            guard token == "old" else { return NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "") }
            return try await withCheckedThrowingContinuation { answer = $0 }
        }
        let restoring = Task { await session.restore() }
        while answer == nil { await Task.yield() }
        precondition(session.state == .signedIn(cached)) // Home is open from the cache.
        return { result in
            answer?.resume(with: result)
            await restoring.value
        }
    }

    private static func aCachedHomeReceivesVerifiedSharingOwner() async {
        let session = AuthSession()
        let reply = await launch(session)
        // This is the same cached signed-in state that lets Home create its store.
        precondition(session.user?.id == cached.id)
        precondition(session.sharingLoginID == nil)
        await reply(.success(cached))
        precondition(session.sharingLoginID != nil)
        precondition(SharedShareSession.publishedToken == "old")
    }

    private static func aLateRejectionKeepsANewSignIn() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        AccountAPI.signInToken = "new"
        try? await session.emailSignIn(email: "a@example.com", credential: "123456", password: false)
        precondition(session.token == "new")
        await reply(.failure(NuphosAPI.Failure.unauthorized))
        precondition(session.token == "new")
        precondition(Keychain.items[AuthSession.tokenKey] == "new")
        precondition(session.user?.id == "u-new")
        precondition(SharedShareSession.publishedToken == "new")
    }

    private static func aLateSuccessKeepsANewSharedSignIn() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        AccountAPI.signInToken = "new"
        try? await session.emailSignIn(email: "a@example.com", credential: "123456", password: false)
        precondition(SharedShareSession.publishedToken == "new")
        await reply(.success(cached))
        precondition(session.token == "new")
        precondition(session.user?.id == "u-new")
        precondition(SharedShareSession.publishedToken == "new", "late restore must not replace the new shared sign-in")
    }

    private static func aLateRejectionAfterSignOutStaysSignedOut() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        precondition(LaunchCache.user == nil)
        await reply(.failure(NuphosAPI.Failure.unauthorized))
        precondition(session.state == .signedOut(error: nil))
    }

    private static func aLateFailureAfterSignOutShowsNoError() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        await reply(.failure(URLError(.notConnectedToInternet)))
        precondition(session.state == .signedOut(error: nil))
    }

    private static func aLateAnswerAfterSignOutStaysSignedOut() async {
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        await reply(.success(cached))
        precondition(session.state == .signedOut(error: nil))
        precondition(session.user == nil)
        precondition(SharedShareSession.publishedToken == nil, "late restore must not resurrect shared sign-in")
    }
}
