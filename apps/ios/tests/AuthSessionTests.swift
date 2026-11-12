import Foundation

/// The launch check opens Home from the cache and asks `/auth/me` behind it,
/// so its answer can arrive after the user has signed out or in again.
@main @MainActor struct AuthSessionTests {
    static func main() async {
        await aCachedHomeReceivesVerifiedSharingOwner()
        await newIdentityWaitsForPushCleanup()
        await aLateConsentCannotGrantAnotherAccount()
        await aLateRefreshCannotOverwriteAnotherAccount()
        await expiredSelectionKeepsOtherAccounts()
        await addingAndCancelingPreservesTheOriginalSession()
        await aLateRejectionKeepsANewSignIn()
        await aLateSuccessKeepsANewSharedSignIn()
        await aLateRejectionAfterSignOutStaysSignedOut()
        await aLateFailureAfterSignOutShowsNoError()
        await aLateAnswerAfterSignOutStaysSignedOut()
        await aSignInWithTwoFactorWaitsForTheCode()
        print("Auth session launch check passed")
    }

    private static func newIdentityWaitsForPushCleanup() async {
        Keychain.items = [:]
        var readBob = false
        NuphosAPI.me = { token in
            if token == "bob" { readBob = true }
            return NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "")
        }
        let session = AuthSession()
        await signIn(session, as: "alice")
        let alice = session.savedAccounts.active!.id
        var release: CheckedContinuation<Void, Never>?
        PushNotifications.shared.activation = { _ in await withCheckedContinuation { release = $0 } }
        let pushing = Task { await session.activatePush() }
        while release == nil { await Task.yield() }
        session.addAccount()
        precondition(!PushNotifications.shared.routingEnabled)
        let adding = Task { await signIn(session, as: "bob") }
        while !readBob { await Task.yield() }
        precondition(session.user == nil)
        precondition(session.savedAccounts.active?.id == alice)
        release?.resume()
        await pushing.value
        await adding.value
        precondition(session.user?.id == "u-bob")
        precondition(!PushNotifications.shared.routingEnabled)
        PushNotifications.shared.activation = nil
    }

    private static func aLateConsentCannotGrantAnotherAccount() async {
        Keychain.items = [:]
        NuphosAPI.me = { token in NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "") }
        let session = AuthSession()
        await signIn(session, as: "alice")
        let alice = session.savedAccounts.active!.id
        session.addAccount()
        await signIn(session, as: "bob")
        let bob = session.savedAccounts.active!.id
        await session.selectAccount(alice)
        var answer: CheckedContinuation<AccountAPI.Consent, Error>?
        AccountAPI.consentReply = { token in
            if token == "alice" { return try await withCheckedThrowingContinuation { answer = $0 } }
            return .init(version: AccountAPI.aiConsentVersion, accepted: false)
        }
        let pending = Task { await session.loadAIConsent() }
        while answer == nil { await Task.yield() }
        await session.selectAccount(bob)
        precondition(!session.aiConsentAccepted)
        answer?.resume(returning: .init(version: AccountAPI.aiConsentVersion, accepted: true))
        await pending.value
        precondition(!session.aiConsentAccepted)
        precondition(session.user?.id == "u-bob")
        AccountAPI.consentReply = nil
    }

    private static func aSignInWithTwoFactorWaitsForTheCode() async {
        Keychain.items = [:]
        NuphosAPI.me = { token in NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "") }
        let session = AuthSession()
        AccountAPI.mfaChallenge = "challenge"
        await signIn(session, as: "carol")
        precondition(session.user == nil)
        precondition(session.mfaChallenge?.token == "challenge")
        precondition(session.savedAccounts.active == nil)

        var refused = false
        do { try await session.verifyMfa(code: "000000") } catch { refused = true }
        precondition(refused && session.user == nil && session.mfaChallenge != nil)

        try? await session.verifyMfa(code: "654321")
        precondition(session.user?.id == "u-carol")
        precondition(session.mfaChallenge == nil)
        AccountAPI.mfaChallenge = nil
    }

    private static func signIn(_ session: AuthSession, as name: String) async {
        AccountAPI.signInToken = name
        try? await session.emailSignIn(email: "\(name)@example.com", credential: "123456", password: false)
    }

    private static func aLateRefreshCannotOverwriteAnotherAccount() async {
        Keychain.items = [:]
        NuphosAPI.me = { token in NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "") }
        let session = AuthSession()
        await signIn(session, as: "alice")
        let alice = session.savedAccounts.active!.id
        session.addAccount()
        await signIn(session, as: "bob")
        let bob = session.savedAccounts.active!.id
        await session.selectAccount(alice)
        var answer: CheckedContinuation<NuphosUser, Error>?
        NuphosAPI.me = { token in
            if token == "alice" { return try await withCheckedThrowingContinuation { answer = $0 } }
            return NuphosUser(id: "u-bob", email: "", name: "", username: "", avatarURL: "")
        }
        let pending = Task { await session.refreshUser() }
        while answer == nil { await Task.yield() }
        await session.selectAccount(bob)
        answer?.resume(returning: NuphosUser(id: "u-alice", email: "", name: "Late Alice", username: "", avatarURL: ""))
        await pending.value
        precondition(session.user?.id == "u-bob")
        precondition(session.savedAccounts.active?.id == bob)
    }

    private static func expiredSelectionKeepsOtherAccounts() async {
        Keychain.items = [:]
        NuphosAPI.me = { token in NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "") }
        let session = AuthSession()
        await signIn(session, as: "alice")
        let alice = session.savedAccounts.active!.id
        session.addAccount()
        await signIn(session, as: "bob")
        let bob = session.savedAccounts.active!.id
        NuphosAPI.me = { token in
            if token == "alice" { throw NuphosAPI.Failure.unauthorized }
            return NuphosUser(id: "u-bob", email: "", name: "", username: "", avatarURL: "")
        }
        await session.selectAccount(alice)
        precondition(session.token == nil)
        precondition(session.savedAccounts.accounts.count == 2)
        precondition(session.savedAccounts.accounts.first { $0.id == alice }?.token == nil)
        await session.selectAccount(bob)
        precondition(session.token == "bob")
        session.removeAccount(alice)
        precondition(session.token == "bob")
        precondition(session.savedAccounts.accounts.count == 1)
    }

    private static func addingAndCancelingPreservesTheOriginalSession() async {
        Keychain.items = [:]
        NuphosAPI.me = { token in NuphosUser(id: "u-\(token)", email: "", name: "", username: "", avatarURL: "") }
        Keychain.items = [:]
        let session = AuthSession()
        AccountAPI.signInToken = "alice"
        try? await session.emailSignIn(email: "a@example.com", credential: "123456", password: false)
        precondition(SharedShareSession.publishedToken == "alice")
        session.addAccount()
        precondition(SharedShareSession.publishedToken == nil, "adding an account must revoke the prior share identity")
        precondition(session.token == nil)
        precondition(session.savedAccounts.accounts.count == 1)
        await session.cancelAddAccount()
        precondition(session.token == "alice")
        session.addAccount()
        AccountAPI.signInToken = "bob"
        try? await session.emailSignIn(email: "b@example.com", credential: "123456", password: false)
        precondition(session.savedAccounts.accounts.count == 2)
        let alice = session.savedAccounts.accounts.first { $0.user.id == "u-alice" }!
        await session.selectAccount(alice.id)
        precondition(session.token == "alice")
        precondition(session.user?.id == "u-alice")
        precondition(SharedShareSession.publishedToken == "alice", "switching accounts must publish the verified share identity")
        session.signOut()
        precondition(SharedShareSession.publishedToken == nil)
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
        Keychain.items = [:]
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        AccountAPI.signInToken = "new"
        try? await session.emailSignIn(email: "a@example.com", credential: "123456", password: false)
        precondition(session.token == "new")
        await reply(.failure(NuphosAPI.Failure.unauthorized))
        precondition(session.token == "new")
        precondition(session.savedAccounts.active?.token == "new")
        precondition(session.user?.id == "u-new")
        precondition(SharedShareSession.publishedToken == "new")
    }

    private static func aLateSuccessKeepsANewSharedSignIn() async {
        Keychain.items = [:]
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
        Keychain.items = [:]
        let session = AuthSession()
        let reply = await launch(session)
        let clears = TransferFiles.clears
        session.signOut()
        precondition(LaunchCache.user == nil)
        precondition(TransferFiles.clears == clears + 1, "sign-out drops downloaded attachments")
        await reply(.failure(NuphosAPI.Failure.unauthorized))
        precondition(session.state == .signedOut(error: nil))
    }

    private static func aLateFailureAfterSignOutShowsNoError() async {
        Keychain.items = [:]
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        await reply(.failure(URLError(.notConnectedToInternet)))
        precondition(session.state == .signedOut(error: nil))
    }

    private static func aLateAnswerAfterSignOutStaysSignedOut() async {
        Keychain.items = [:]
        let session = AuthSession()
        let reply = await launch(session)
        session.signOut()
        await reply(.success(cached))
        precondition(session.state == .signedOut(error: nil))
        precondition(session.user == nil)
        precondition(SharedShareSession.publishedToken == nil, "late restore must not resurrect shared sign-in")
    }
}
