import AuthenticationServices
import Foundation

/// The browser leg of a connector connect flow.
///
/// Every provider's `/setup` callback on the backend ends on the same landing
/// page, which redirects to `nuphos://<provider>-callback?...`. That custom
/// scheme is what `ASWebAuthenticationSession` watches for, so one session
/// serves every provider: the query carries either the result or an `error`.
@MainActor
final class ConnectorOAuth {
    enum Failure: LocalizedError {
        case cancelled
        case provider(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: "Connection cancelled."
            case .provider(let message): message
            }
        }
    }

    private let presentationContext = WebAuthPresentationContext()
    /// `ASWebAuthenticationSession` must outlive `start()`.
    private var session: ASWebAuthenticationSession?

    /// Opens `url` in the authentication browser and resolves with the query
    /// of the `nuphos://` redirect that ends it. Throws `.cancelled` when the
    /// user dismisses the sheet, so callers can stay quiet about it.
    ///
    /// `expectedHost` is the `nuphos://<host>` this flow is waiting for. The
    /// scheme alone is not enough: every connector shares it, so without the
    /// host check one provider's redirect could satisfy another's flow.
    func run(url: URL, expectedHost: String) async throws -> [String: String] {
        let callback = try await authenticate(url: url)
        guard callback.host()?.lowercased() == expectedHost else {
            throw Failure.provider("The browser came back to an unexpected address.")
        }
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        var query: [String: String] = [:]
        for item in items {
            guard let value = item.value, !value.isEmpty else { continue }
            query[item.name] = value
        }
        if let message = query["error_description"] ?? query["error"] {
            throw Failure.provider(message)
        }
        return query
    }

    private func authenticate(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callback: .customScheme(NuphosWeb.callbackScheme)
            ) { callbackURL, error in
                if let error {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    continuation.resume(throwing: cancelled ? Failure.cancelled : error)
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: Failure.provider("The provider did not complete the connection."))
                }
            }
            session.presentationContextProvider = presentationContext
            // Shared cookies: the user is almost always already signed in to
            // the provider in Safari, and an ephemeral session would make them
            // retype a password on a phone keyboard instead.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                continuation.resume(throwing: Failure.provider("Could not open the browser."))
            }
        }
    }
}
