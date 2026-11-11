import Foundation
import CryptoKit
import Security

enum NuphosWeb {
    static let siteURL = URL(string: "https://nuphos.ai")!
    static let callbackScheme = "nuphos"
    static let callbackHost = "google-callback"

    enum CallbackResult: Equatable {
        case code(String)
        case failure(String)
    }

    enum Provider: String, CaseIterable {
        case apple, google

        var name: String { self == .apple ? "Apple" : "Google" }
    }

    static func providers(header: String?) -> [Provider] {
        guard let header else { return [.google] }
        let configured = Set(header.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) })
        return Provider.allCases.filter { configured.contains($0.rawValue) }
    }

    static func availableProviders(baseURL: URL) async throws -> [Provider] {
        var request = URLRequest(url: baseURL.appending(path: "auth/social/login"))
        request.timeoutInterval = 10
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if response.statusCode == 503 { return [] }
        guard (200..<300).contains(response.statusCode) else { throw URLError(.badServerResponse) }
        return providers(header: response.value(forHTTPHeaderField: "X-Nuphos-Social-Providers"))
    }

    static func loginURL(baseURL: URL, handle: String, provider: Provider) -> URL {
        var url = URLComponents(url: baseURL.appending(path: "auth/social/\(provider.rawValue)/start"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "handle", value: handle)]
        return url.url!
    }

    /// Only the state is checked: the code is single-use and redeemable solely
    /// with this sign-in's handle and PKCE verifier, so a stray path, fragment
    /// or extra parameter added on the way back is not worth failing over.
    static func parseCallback(_ url: URL, expectedState: String) -> CallbackResult? {
        guard url.scheme == callbackScheme, url.host == callbackHost,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              items.first(where: { $0.name == "state" })?.value == expectedState else { return nil }
        if items.contains(where: { $0.name == "error" }) { return .failure("Sign-in did not complete. Please try again.") }
        if let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty { return .code(code) }
        return nil
    }

    static func randomSecret() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw CocoaError(.coderInvalidValue) }
        return encode(Data(bytes))
    }

    static func challenge(_ verifier: String) -> String { encode(Data(SHA256.hash(data: Data(verifier.utf8)))) }
    private static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
