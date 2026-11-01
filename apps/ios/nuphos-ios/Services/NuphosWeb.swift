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

    static func loginURL(baseURL: URL, handle: String) -> URL {
        var url = URLComponents(url: baseURL.appending(path: "auth/social/login"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "handle", value: handle)]
        return url.url!
    }

    static func parseCallback(_ url: URL, expectedState: String) -> CallbackResult? {
        guard url.scheme == callbackScheme, url.host == callbackHost,
              url.path.isEmpty, url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ ["state", "code", "error"].contains($0.name) }),
              items.first(where: { $0.name == "state" })?.value == expectedState else { return nil }
        let code = items.first(where: { $0.name == "code" })?.value
        let error = items.first(where: { $0.name == "error" })?.value
        if let code, error == nil, code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil { return .code(code) }
        if error != nil, code == nil { return .failure("Sign-in did not complete. Please try again.") }
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
