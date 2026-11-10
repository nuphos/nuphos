import Foundation

@main struct AccountOriginTests {
    static func main() {
        NuphosAPI.rememberOrigin("https://first.example.com", token: "synthetic-first")
        NuphosAPI.rememberOrigin("https://second.example.com", token: "synthetic-second")
        precondition(NuphosAPI.baseURL(for: "synthetic-first").host == "first.example.com")
        precondition(NuphosAPI.baseURL(for: "synthetic-second").host == "second.example.com")
        precondition(!NuphosAPI.rememberOrigin("https://second.example.com", token: "synthetic-first"))
        precondition(NuphosAPI.baseURL(for: "synthetic-first").host == "first.example.com")
        precondition(NuphosAPI.baseURL(for: nil) == NuphosAPI.baseURL)
        print("Account request origin isolation passed")
    }
}
