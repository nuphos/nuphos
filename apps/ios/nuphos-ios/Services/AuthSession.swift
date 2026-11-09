import AuthenticationServices
import Foundation
import Observation
import SwiftUI

/// Source of truth for "who is signed in". One instance lives for the app's
/// lifetime and every screen reads `state` from it.
@Observable
final class AuthSession {
    enum State: Equatable {
        /// Launch: checking the Keychain for a token and validating it.
        case restoring
        /// No usable session. `error` is copy for the login screen.
        case signedOut(error: String?)
        /// The browser is up, or we are exchanging the callback for a user.
        case signingIn
        case signedIn(NuphosUser)
    }

    private(set) var state: State = .restoring {
        didSet {
            switch state {
            case .signedIn(let user):
                Analytics.shared.identify(user)
                if aiConsentAccepted, let version = aiConsentVersion {
                    LaunchCache.write(LaunchCache.User(user: user, aiConsentVersion: version))
                }
            case .signedOut: Analytics.shared.reset()
            case .restoring, .signingIn: break
            }
        }
    }
    private(set) var sharingLoginID: UUID?
    private(set) var token: String?
    private(set) var aiConsentAccepted = false
    private(set) var aiConsentVersion: String?
    private(set) var aiConsentError: String?

    let savedAccounts = SavedAccounts()
    private(set) var generation = 0
    private(set) var accountError: String?
    private(set) var addingAccount = false
    private var returnAccountID: String?
    private var identityOrigin = NuphosAPI.baseURL.absoluteString
    private var pushActivation: Task<Void, Never>?
    private var pushCleanup: Task<Void, Never>?

    static let tokenKey = "session-token"
    private let presentationContext = WebAuthPresentationContext()
    private var webSession: ASWebAuthenticationSession?

    var user: NuphosUser? {
        if case .signedIn(let user) = state { return user }
        return nil
    }

    func restoreForSharing(_ lease: SharedShareSession.Record) async throws {
        try SharedShareSession.validate(lease)
        guard ["https", "http"].contains(lease.backend.scheme?.lowercased() ?? ""),
              lease.backend.host != nil, lease.backend.user == nil, lease.backend.password == nil else { throw SharedShareSession.Failure.identity }
        guard NuphosAPI.rememberOrigin(lease.backend.absoluteString, token: lease.token) else { throw SharedShareSession.Failure.identity }
        NuphosAPI.sharedSessionBaseURL = lease.backend
        let user = try await NuphosAPI.currentUser(token: lease.token)
        try SharedShareSession.validate(lease)
        guard user.id == lease.accountID else { throw SharedShareSession.Failure.identity }
        token = lease.token
        await loadAIConsent()
        guard aiConsentAccepted else { throw SharedShareSession.Failure.unavailable }
        state = .signedIn(user)
    }

    // MARK: - Launch

    /// Restores a saved session. The user the last launch showed opens Home
    /// at once while the token is checked behind it. A token the backend no
    /// longer honours is discarded; a network failure keeps it, and without
    /// a cached user asks the user to retry.
    func restore() async {
        #if DEBUG
        // `-preview-home` launch argument: render the home screen with a
        // sample user, for UI work without a real sign-in.
        #if targetEnvironment(simulator)
        if let fixture = ProcessInfo.processInfo.environment["NUPHOS_PREVIEW_RESPONSES"] {
            UserDefaults.standard.set(fixture, forKey: "previewResponses")
        }
        let previewFixture = UserDefaults.standard.string(forKey: "previewResponses")
        #else
        let previewFixture: String? = nil
        #endif
        // Login fixtures exercise the real form without creating a real account.
        if CommandLine.arguments.contains("-preview-login") {
            if previewFixture != nil { URLProtocol.registerClass(PreviewTransport.self) }
            state = .signedOut(error: nil)
            return
        }
        if !CommandLine.arguments.contains("-share-verification") && (CommandLine.arguments.contains("-preview-home") || previewFixture != nil) {
            if previewFixture != nil {
                URLProtocol.registerClass(PreviewTransport.self)
                token = "preview-only"
                Task { await PushNotifications.shared.activate(authToken: "preview-only") }
            }
            aiConsentAccepted = !CommandLine.arguments.contains("-preview-consent")
            aiConsentVersion = AccountAPI.aiConsentVersion
            state = .signedIn(.preview)
            return
        }
        #endif

        if let active = savedAccounts.active, active.token != nil {
            await selectAccount(active.id)
            return
        }
        guard !savedAccounts.hasRegistry, savedAccounts.error == nil, let saved = Keychain.read(Self.tokenKey) else {
            state = .signedOut(error: nil)
            return
        }

        let expected = generation
        token = saved
        if let cached = LaunchCache.read(LaunchCache.User.self), cached.aiConsentVersion == AccountAPI.aiConsentVersion {
            aiConsentAccepted = true
            aiConsentVersion = cached.aiConsentVersion
            state = .signedIn(cached.user)
        }
        do {
            let user = try await NuphosAPI.currentUser(token: saved)
            guard generation == expected, token == saved else { return }
            try savedAccounts.save(user: user, token: saved, origin: identityOrigin)
            Keychain.delete(Self.tokenKey)
            await loadAIConsent()
            // Home may already be open from the cache, so the user can sign
            // out, or in again, before this answers. That session wins.
            guard generation == expected, token == saved else { return }
            sharingLoginID = try? SharedShareSession.publishLogin(token: saved, accountID: user.id, backend: NuphosAPI.baseURL(for: saved))
            state = .signedIn(user)
        } catch NuphosAPI.Failure.unauthorized {
            guard generation == expected, token == saved else { return }
            clearToken()
            state = .signedOut(error: nil)
        } catch {
            guard generation == expected, token == saved else { return }
            if self.user == nil {
                state = .signedOut(error: "We could not reach Nuphos. Check your connection and try again.")
            }
        }
    }

    // MARK: - Sign in

    func dismissSignInError() {
        if case .signedOut(let error) = state, error != nil { state = .signedOut(error: nil) }
    }

    func signIn(provider: NuphosWeb.Provider) async {
        guard state != .signingIn else { return }
        let expected = generation
        let origin = NuphosAPI.baseURL.absoluteString
        state = .signingIn

        do {
            let verifier = try NuphosWeb.randomSecret()
            let clientState = try NuphosWeb.randomSecret()
            struct Registration: Decodable { let handle: String }
            let registration: Registration = try await AccountAPI.request("native/session", method: "POST", body: [
                "redirectUri": "nuphos://google-callback", "codeChallenge": NuphosWeb.challenge(verifier),
                "codeChallengeMethod": "S256", "clientState": clientState
            ])
            guard generation == expected, NuphosAPI.baseURL.absoluteString == origin else { return }
            let callback = try await authenticate(url: NuphosWeb.loginURL(baseURL: NuphosAPI.baseURL, handle: registration.handle, provider: provider))
            guard generation == expected, NuphosAPI.baseURL.absoluteString == origin else { return }
            switch NuphosWeb.parseCallback(callback, expectedState: clientState) {
            case .code(let code):
                let result: AccountAPI.SignIn = try await AccountAPI.request("native/session/redeem", method: "POST", body: [
                    "handle": registration.handle, "codeVerifier": verifier, "code": code
                ])
                await complete(token: result.token, expected: expected, origin: origin)
            case .failure(let message): state = .signedOut(error: message)
            case nil: state = .signedOut(error: "Unexpected sign-in response. Please try again.")
            }
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            if generation == expected { state = .signedOut(error: nil) }
        } catch {
            if generation == expected { state = .signedOut(error: error.localizedDescription) }
        }
    }

    /// Exchanges a fresh token for the user, and only then persists it: a
    /// token that cannot fetch its own user is not a session worth keeping.
    private func complete(token: String, expected: Int, origin: String) async {
        do {
            guard generation == expected, NuphosAPI.baseURL.absoluteString == origin else { return }
            guard NuphosAPI.rememberOrigin(origin, token: token) else { throw NuphosAPI.Failure.unauthorized }
            let user = try await NuphosAPI.currentUser(token: token)
            guard generation == expected, NuphosAPI.baseURL.absoluteString == origin else { return }
            await pushCleanup?.value
            guard generation == expected, NuphosAPI.baseURL.absoluteString == origin else { return }
            try savedAccounts.save(user: user, token: token, origin: origin)
            Keychain.delete(Self.tokenKey)
            self.token = token
            identityOrigin = origin
            addingAccount = false
            returnAccountID = nil
            await loadAIConsent()
            guard generation == expected, self.token == token else { return }
            sharingLoginID = try? SharedShareSession.publishLogin(token: token, accountID: user.id, backend: NuphosAPI.baseURL(for: token))
            state = .signedIn(user)
            Analytics.shared.track("login")
        } catch {
            if generation == expected { state = .signedOut(error: error.localizedDescription) }
        }
    }

    func addAccount() {
        returnAccountID = savedAccounts.active?.id
        addingAccount = true
        resetIdentity()
        state = .signedOut(error: nil)
    }

    func cancelAddAccount() async {
        let previous = returnAccountID
        addingAccount = false
        returnAccountID = nil
        if let previous { await selectAccount(previous) }
        else { resetIdentity(); state = .signedOut(error: nil) }
    }

    func selectAccount(_ id: String) async {
        guard let account = savedAccounts.accounts.first(where: { $0.id == id }) else { return }
        if account.token == nil {
            addAccount()
            UserDefaults.standard.set(account.origin, forKey: NuphosAPI.baseURLKey)
            return
        }
        guard let saved = account.token else { return }
        if savedAccounts.active?.id == id, token == saved, user?.id == account.user.id { return }
        do { try savedAccounts.select(id) }
        catch { accountError = "We could not save the account selection. Try again."; return }
        resetIdentity()
        addingAccount = false
        returnAccountID = nil
        let expected = generation
        state = .restoring
        await pushCleanup?.value
        guard generation == expected else { return }
        UserDefaults.standard.set(account.origin, forKey: NuphosAPI.baseURLKey)
        identityOrigin = account.origin
        token = saved
        do {
            let user = try await NuphosAPI.currentUser(token: saved)
            guard generation == expected else { return }
            guard user.id == account.user.id else { throw NuphosAPI.Failure.unauthorized }
            try savedAccounts.save(user: user, token: saved, origin: account.origin)
            await loadAIConsent()
            guard generation == expected else { return }
            sharingLoginID = try? SharedShareSession.publishLogin(token: saved, accountID: user.id, backend: NuphosAPI.baseURL(for: saved))
            state = .signedIn(user)
        } catch NuphosAPI.Failure.unauthorized {
            guard generation == expected else { return }
            do { try savedAccounts.invalidate(id) }
            catch { state = .signedOut(error: "We could not remove the expired session. Try again."); return }
            token = nil
            state = .signedOut(error: "This account's session expired. Sign in again.")
        } catch {
            guard generation == expected else { return }
            token = nil
            state = .signedOut(error: "We could not open this account. Check your connection and try again.")
        }
    }

    func removeAccount(_ id: String) {
        guard let account = savedAccounts.accounts.first(where: { $0.id == id }) else { return }
        if savedAccounts.active?.id == id, token != nil { signOut(); return }
        do { try savedAccounts.remove(id) }
        catch { accountError = "We could not remove this saved account. Try again."; return }
        let cleanup = pushCleanup
        if let token = account.token { Task { await cleanup?.value; await AccountAPI.endSession(token: token) } }
    }

    private func resetIdentity() {
        accountError = nil
        sharingLoginID = nil
        SharedShareSession.revoke()
        PushNotifications.shared.invalidateRouting()
        generation += 1
        webSession?.cancel()
        webSession = nil
        let previous = pushCleanup
        let activation = pushActivation
        pushCleanup = Task { await previous?.value; await activation?.value; await PushNotifications.shared.deactivate() }
        token = nil
        aiConsentAccepted = false
        aiConsentVersion = nil
        aiConsentError = nil
        ComposerDrafts.clear()
        LaunchCache.clear()
        TransferFiles.clear()
    }

    func activatePush() async {
        let expected = generation
        await pushCleanup?.value
        guard expected == generation, let token, user != nil else { return }
        let task = Task {
            guard self.generation == expected, self.token == token else { return }
            await PushNotifications.shared.activate(authToken: token)
        }
        pushActivation = task
        await task.value
    }

    private func authenticate(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .customScheme(NuphosWeb.callbackScheme)
            ) { callbackURL, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: Failure.noCallback)
                }
            }
            session.presentationContextProvider = presentationContext
            // Shared cookies: a Google account already signed in on this
            // device is one tap away instead of a full credential entry.
            session.prefersEphemeralWebBrowserSession = false
            webSession = session

            if !session.start() {
                continuation.resume(throwing: Failure.couldNotStart)
            }
        }
    }

    /// A failed lookup keeps what is known: nothing on a fresh sign-in, the
    /// cached answer on a launch that already opened Home.
    func loadAIConsent() async {
        aiConsentError = nil
        guard let token else { return }
        let expected = generation
        do {
            let result: AccountAPI.Consent = try await AccountAPI.request("ai-consent", token: token)
            guard generation == expected, self.token == token else { return }
            aiConsentVersion = result.version
            aiConsentAccepted = result.accepted && result.version == AccountAPI.aiConsentVersion
        } catch { if generation == expected { aiConsentError = error.localizedDescription } }
    }

    func setAIConsent(accepted: Bool) async throws {
        guard let token, let version = aiConsentVersion, version == AccountAPI.aiConsentVersion else {
            throw NuphosAPI.Failure.http(409, message: "Please update Nuphos to read the latest AI notice.")
        }
        let expected = generation
        let result: AccountAPI.Consent = try await AccountAPI.request("ai-consent", method: "PUT", token: token, body: ["version": version, "accepted": accepted])
        guard generation == expected, self.token == token else { return }
        aiConsentAccepted = result.accepted
        if !accepted {
            ComposerDrafts.clear()
            LaunchCache.clear()
        }
    }

    func emailSignIn(email: String, credential: String, password: Bool, newPassword: String? = nil) async throws {
        guard state != .signingIn else { return }
        let expected = generation
        let origin = NuphosAPI.baseURL.absoluteString
        state = .signingIn
        do {
            var body = ["email": email]
            body[password ? "password" : "code"] = credential
            if let newPassword { body["password"] = newPassword }
            let path = newPassword != nil ? "password/set" : password ? "password/sign-in" : "email/verify-code"
            let result: AccountAPI.SignIn = try await AccountAPI.request(path, method: "POST", body: body)
            await complete(token: result.token, expected: expected, origin: origin)
        } catch {
            if generation == expected { state = .signedOut(error: error.localizedDescription) }
            throw error
        }
    }

    // MARK: - Signed in

    /// Re-fetches the user, e.g. on pull-to-refresh. A 401 signs out.
    func updateProfile(name: String, username: String, avatarURL: String) async throws {
        guard let token else { throw NuphosAPI.Failure.unauthorized }
        let expected = generation
        let user: NuphosUser = try await AccountAPI.request("me", method: "PATCH", token: token, body: ["name": name, "username": username, "avatarURL": avatarURL])
        guard generation == expected, self.token == token else { return }
        try savedAccounts.save(user: user, token: token, origin: identityOrigin)
        state = .signedIn(user)
    }

    /// Uploads a profile photo, or removes it with `nil`.
    func setAvatar(_ image: Data?) async throws {
        guard let token else { throw NuphosAPI.Failure.unauthorized }
        let expected = generation
        let user: NuphosUser = try await AccountAPI.request("me/avatar", method: image == nil ? "DELETE" : "PUT", token: token, upload: image)
        guard generation == expected, self.token == token else { return }
        try savedAccounts.save(user: user, token: token, origin: identityOrigin)
        state = .signedIn(user)
    }

    func refreshUser() async {
        guard let token, case .signedIn = state else { return }
        let expected = generation
        do {
            let user = try await NuphosAPI.currentUser(token: token)
            guard generation == expected, self.token == token else { return }
            try savedAccounts.save(user: user, token: token, origin: identityOrigin)
            state = .signedIn(user)
        } catch NuphosAPI.Failure.unauthorized {
            guard generation == expected, self.token == token else { return }
            signOut(error: NuphosAPI.Failure.unauthorized.localizedDescription)
        } catch {
            // Keep showing what we have; transient failures are not a reason
            // to drop a session.
        }
    }

    func signOut(error: String? = nil) {
        let ended = token
        if let id = savedAccounts.active?.id {
            do { try savedAccounts.remove(id) }
            catch { accountError = "We could not sign out. Try again."; return }
        }
        Analytics.shared.track("logout")
        resetIdentity()
        addingAccount = false
        returnAccountID = nil
        Keychain.delete(Self.tokenKey)
        Keychain.delete("openai-api-key")
        let cleanup = pushCleanup
        Task {
            await cleanup?.value
            if let ended { await AccountAPI.endSession(token: ended) }
        }
        state = .signedOut(error: error)
    }

    private func clearToken() {
        sharingLoginID = nil
        SharedShareSession.revoke()
        Keychain.delete(Self.tokenKey)
        LaunchCache.clear()
        TransferFiles.clear()
        token = nil
        aiConsentAccepted = false
        aiConsentVersion = nil
    }

    enum Failure: LocalizedError {
        case noCallback
        case couldNotStart

        var errorDescription: String? {
            switch self {
            case .noCallback: "The sign-in window closed before finishing. Please try again."
            case .couldNotStart: "We could not open the sign-in window. Please try again."
            }
        }
    }
}

/// Anchors a system web-authentication sheet to the app's key window. Shared
/// by sign-in and the connector connect flows.
final class WebAuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            #if NUPHOS_SHARE_EXTENSION
            return ASPresentationAnchor()
            #elseif os(macOS)
            return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? ASPresentationAnchor()
            #else
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first {
                return window
            }
            // Sign-in is only ever started from a button on screen, so a
            // scene exists; this is the last resort, not a code path.
            guard let scene = scenes.first else {
                preconditionFailure("Sign-in started with no window scene to present from")
            }
            return UIWindow(windowScene: scene)
            #endif
        }
    }
}
