import Foundation

private func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); exit(1) }
}

/// The error a request ends with. A blocked request never reaches the network,
/// so these pass offline and would fail by message if one ever did.
private func failure(_ session: URLSession, _ url: String) async -> String? {
    do {
        _ = try await session.data(from: URL(string: url)!)
        return nil
    } catch {
        return error.localizedDescription
    }
}

private let blocked = "Preview mode blocked this request"

@main
struct PreviewIsolationTests {
    static func main() async {
        let route = PreviewIsolation.route
        check(route(URL(string: "https://api.preview.invalid/teams")) == .fixture, "the preview API is the fixture")
        for url in ["https://api.nuphos.ai/agent/chat", "wss://api.nuphos.ai/x", "http://nuphos.ai/",
                    "https://lh3.googleusercontent.com/a", "https://127.0.0.1.example.com/", "https://example.com/"] {
            check(route(URL(string: url)) == .blocked, "\(url) is blocked")
        }
        for url in ["http://127.0.0.1:8765/a.png", "http://localhost:3000/", "file:///tmp/a.png", "data:image/png;base64,AA"] {
            check(route(URL(string: url)) == .local, "\(url) stays local")
        }
        check(route(nil) == .blocked, "no URL is blocked")

        check(PreviewIsolation.isPreview(arguments: ["-preview-home"], fixture: nil), "a preview argument is preview")
        check(PreviewIsolation.isPreview(arguments: [], fixture: "/tmp/f.json"), "a fixture is preview")
        check(!PreviewIsolation.isPreview(arguments: ["app"], fixture: nil), "a normal launch is not preview")
        check(!PreviewIsolation.isPreview(arguments: ["-preview-home", "-share-verification"], fixture: nil),
              "share verification runs its own backend")

        // A normal launch changes nothing.
        PreviewIsolation.installIfPreview(arguments: ["app"], fixture: nil)
        check(!PreviewIsolation.isActive, "a normal launch stays inactive")
        check(NuphosAPI.baseURL == NuphosAPI.defaultBaseURL, "a normal launch keeps the backend")
        check(!(URLSessionConfiguration.default.protocolClasses ?? []).contains { $0 == PreviewTransport.self },
              "a normal launch leaves sessions alone")

        let fixture = FileManager.default.temporaryDirectory.appendingPathComponent("preview-\(UUID().uuidString).json")
        try! Data(#"{"GET /teams": {"status": 200, "body": {"teams": []}}}"#.utf8).write(to: fixture)
        defer { try? FileManager.default.removeItem(at: fixture) }
        UserDefaults.standard.set(fixture.path, forKey: "previewResponses")
        defer { UserDefaults.standard.removeObject(forKey: "previewResponses") }

        PreviewIsolation.installIfPreview(arguments: ["-preview-home"], fixture: fixture.path)
        check(PreviewIsolation.isActive, "preview is active")
        check(NuphosAPI.baseURL == PreviewIsolation.apiBase, "the API moves to the reserved host")

        for (name, session) in [
            ("shared", URLSession.shared),
            ("default", URLSession(configuration: .default)),
            ("ephemeral", URLSession(configuration: .ephemeral)),
        ] {
            for url in ["https://api.nuphos.ai/avatars/a.webp", "https://lh3.googleusercontent.com/a", "https://example.com/"] {
                let message = await failure(session, url)
                check(message?.contains(blocked) == true, "\(name) blocks \(url), got \(message ?? "a response")")
            }
            let (data, response) = try! await session.data(from: NuphosAPI.baseURL.appending(path: "teams"))
            check((response as? HTTPURLResponse)?.statusCode == 200, "\(name) answers from the fixture")
            check(String(data: data, encoding: .utf8)?.contains("teams") == true, "\(name) returns the fixture body")
        }

        // What an `activeRun` fixture starts.
        var request = URLRequest(url: NuphosAPI.defaultBaseURL.appending(path: "agent/chat"))
        request.httpMethod = "POST"
        do {
            for try await _ in SSEClient.events(for: request) { check(false, "a blocked stream sent an event") }
            check(false, "a blocked stream ended without failing")
        } catch {
            check(error.localizedDescription.contains(blocked), "SSEClient is blocked, got \(error)")
        }

        check(PreviewIsolation.refuses(URL(string: "https://example.com/")!), "a web view refuses the network")
        check(!PreviewIsolation.refuses(URL(string: "http://localhost:3000/")!), "a web view can open a local page")
        print("PASS: preview mode stays off the network on every session, and a normal launch is untouched")
    }
}
