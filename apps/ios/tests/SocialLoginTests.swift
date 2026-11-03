import Foundation

@main struct SocialLoginTests {
    static func main() throws {
        let state = "expected-state"
        let code = String(repeating: "c", count: 43)
        func parse(_ query: String) -> NuphosWeb.CallbackResult? {
            NuphosWeb.parseCallback(URL(string: "nuphos://google-callback?\(query)")!, expectedState: state)
        }
        precondition(parse("state=\(state)&code=\(code)") == .code(code))
        precondition(parse("state=wrong&code=\(code)") == nil)
        precondition(parse("state=\(state)&token=secret") == nil)
        precondition(parse("state=\(state)&state=\(state)&code=\(code)") == nil)
        precondition(parse("state=\(state)&code=\(code)&error=cancelled") == nil)
        precondition(parse("state=\(state)&code=short") == nil)
        precondition(NuphosWeb.parseCallback(URL(string: "nuphos://google-callback/extra?state=\(state)&code=\(code)")!, expectedState: state) == nil)
        let verifier = try NuphosWeb.randomSecret()
        precondition(verifier.count == 43)
        precondition(NuphosWeb.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let url = NuphosWeb.loginURL(baseURL: URL(string: "https://api.example.com")!, handle: "handle", provider: .google)
        precondition(url.absoluteString == "https://api.example.com/auth/social/google/start?handle=handle")
        let apple = NuphosWeb.loginURL(baseURL: URL(string: "https://self.example.com")!, handle: "a+b&c", provider: .apple)
        precondition(apple.path == "/auth/social/apple/start")
        let items = URLComponents(url: apple, resolvingAgainstBaseURL: false)!.queryItems!
        precondition(items == [URLQueryItem(name: "handle", value: "a+b&c")])
        precondition(NuphosWeb.providers(header: "google,apple") == [.apple, .google])
        precondition(NuphosWeb.providers(header: " google,unknown,google ") == [.google])
        precondition(NuphosWeb.providers(header: "") == [])
        precondition(NuphosWeb.providers(header: nil) == [.google])
        print("Social login callback and PKCE checks passed")
    }
}
