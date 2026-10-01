import Foundation

/// Everything about the browser leg of sign-in that the landing page
/// (`nuphos-landingpage`) decides for us.
///
/// `/login?state=` accepts an *unsigned* base64url JSON blob and keeps just
/// `callbackUrl`, `clientState`, `mobile` (see `sanitizeInboundState` in
/// `src/utils/oauthState.ts`). With `mobile: true`, `/api/google/callback`
/// finishes the flow with a redirect to
///
///     nuphos://google-callback?token=<session token>
///     nuphos://google-callback?error=<human message>
///
/// which is what `ASWebAuthenticationSession` hands back to us.
// Touched to fire the iOS paths filter.
enum NuphosWeb {
    static let siteURL = URL(string: "https://nuphos.ai")!
    static let callbackScheme = "nuphos"
    static let callbackHost = "google-callback"

    enum CallbackResult: Equatable {
        case token(String)
        case failure(String)
    }

    /// The URL the in-app browser opens. Renders the same `/login` page the
    /// web uses, so the Google button, copy and error handling stay in sync.
    static func loginURL() -> URL {
        let state = Data(#"{"mobile":true}"#.utf8).base64URLEncodedString()
        var components = URLComponents(url: siteURL.appending(path: "login"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "state", value: state)]
        return components.url!
    }

    /// Reads the `nuphos://google-callback` redirect. `nil` means the URL is
    /// not ours at all (wrong scheme or host).
    static func parseCallback(_ url: URL) -> CallbackResult? {
        guard url.scheme?.lowercased() == callbackScheme,
              url.host()?.lowercased() == callbackHost,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
        else { return nil }

        func value(_ name: String) -> String? {
            items.first { $0.name == name }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }

        if let token = value("token") { return .token(token) }
        if let error = value("error") { return .failure(error) }
        return .failure("Google did not complete this sign-in.")
    }
}

private extension Data {
    /// RFC 4648 §5, unpadded — the encoding `sanitizeInboundState` decodes.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
