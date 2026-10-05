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
            case .signedIn(let user): Analytics.shared.identify(user)
            case .signedOut: Analytics.shared.reset()
            case .restoring, .signingIn: break
            }
        }
    }
    private(set) var token: String?
    private(set) var aiConsentAccepted = false
    private(set) var aiConsentVersion: String?
    private(set) var aiConsentError: String?

    private static let tokenKey = "session-token"
    private let presentationContext = WebAuthPresentationContext()
    private var webSession: ASWebAuthenticationSession?

    var user: NuphosUser? {
        if case .signedIn(let user) = state { return user }
        return nil
    }

    // MARK: - Launch

    /// Restores a saved session. A token the backend no longer honours is
    /// discarded; a network failure keeps it and asks the user to retry.
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
        if CommandLine.arguments.contains("-preview-home") || previewFixture != nil {
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
        // `-preview-login`: the sign-in screen, leaving any saved session alone.
        if CommandLine.arguments.contains("-preview-login") {
            state = .signedOut(error: nil)
            return
        }
        #endif

        guard let saved = Keychain.read(Self.tokenKey) else {
            state = .signedOut(error: nil)
            return
        }

        token = saved
        do {
            let user = try await NuphosAPI.currentUser(token: saved)
            await loadAIConsent()
            state = .signedIn(user)
        } catch NuphosAPI.Failure.unauthorized {
            clearToken()
            state = .signedOut(error: nil)
        } catch {
            state = .signedOut(error: "We could not reach Nuphos. Check your connection and try again.")
        }
    }

    // MARK: - Sign in

    func signIn() async {
        guard state != .signingIn else { return }
        state = .signingIn

        let callbackURL: URL
        do {
            callbackURL = try await authenticate(url: NuphosWeb.loginURL())
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            state = .signedOut(error: nil)
            return
        } catch {
            state = .signedOut(error: error.localizedDescription)
            return
        }

        switch NuphosWeb.parseCallback(callbackURL) {
        case .token(let token):
            await complete(token: token)
        case .failure(let message):
            state = .signedOut(error: message)
        case nil:
            state = .signedOut(error: "Sign-in returned something we did not expect. Please try again.")
        }
    }

    /// Exchanges a fresh token for the user, and only then persists it: a
    /// token that cannot fetch its own user is not a session worth keeping.
    private func complete(token: String) async {
        do {
            let user = try await NuphosAPI.currentUser(token: token)
            try Keychain.write(token, for: Self.tokenKey)
            self.token = token
            await loadAIConsent()
            state = .signedIn(user)
            Analytics.shared.track("login")
        } catch {
            state = .signedOut(error: error.localizedDescription)
        }
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

    func loadAIConsent() async {
        aiConsentAccepted = false
        aiConsentVersion = nil
        aiConsentError = nil
        guard let token else { return }
        do {
            let result: AccountAPI.Consent = try await AccountAPI.request("ai-consent", token: token)
            aiConsentVersion = result.version
            aiConsentAccepted = result.accepted && result.version == AccountAPI.aiConsentVersion
        } catch { aiConsentError = error.localizedDescription }
    }

    func setAIConsent(accepted: Bool) async throws {
        guard let token, let version = aiConsentVersion, version == AccountAPI.aiConsentVersion else {
            throw NuphosAPI.Failure.http(409, message: "Please update Nuphos to read the latest AI notice.")
        }
        let result: AccountAPI.Consent = try await AccountAPI.request("ai-consent", method: "PUT", token: token, body: ["version": version, "accepted": accepted])
        aiConsentAccepted = result.accepted
        if !accepted { ComposerDrafts.clear() }
    }

    func emailSignIn(email: String, credential: String, password: Bool, newPassword: String? = nil) async throws {
        guard state != .signingIn else { return }
        state = .signingIn
        do {
            var body = ["email": email]
            body[password ? "password" : "code"] = credential
            if let newPassword { body["password"] = newPassword }
            let path = newPassword != nil ? "password/set" : password ? "password/sign-in" : "email/verify-code"
            let result: AccountAPI.SignIn = try await AccountAPI.request(path, method: "POST", body: body)
            await complete(token: result.token)
        } catch {
            state = .signedOut(error: error.localizedDescription)
            throw error
        }
    }

    // MARK: - Signed in

    /// Re-fetches the user, e.g. on pull-to-refresh. A 401 signs out.
    func updateProfile(name: String, username: String, avatarURL: String) async throws {
        guard let token else { throw NuphosAPI.Failure.unauthorized }
        let user: NuphosUser = try await AccountAPI.request("me", method: "PATCH", token: token, body: ["name": name, "username": username, "avatarURL": avatarURL])
        state = .signedIn(user)
    }

    func refreshUser() async {
        guard let token, case .signedIn = state else { return }
        do {
            state = .signedIn(try await NuphosAPI.currentUser(token: token))
        } catch NuphosAPI.Failure.unauthorized {
            signOut(error: NuphosAPI.Failure.unauthorized.localizedDescription)
        } catch {
            // Keep showing what we have; transient failures are not a reason
            // to drop a session.
        }
    }

    func signOut(error: String? = nil) {
        Analytics.shared.track("logout")
        Task { await PushNotifications.shared.deactivate() }
        webSession?.cancel()
        webSession = nil
        clearToken()
        ComposerDrafts.clear()
        state = .signedOut(error: error)
    }

    private func clearToken() {
        Keychain.delete(Self.tokenKey)
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
            #if os(macOS)
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
