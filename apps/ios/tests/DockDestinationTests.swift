import Foundation

enum DockDestinationTests {
    static func run() {
        webPagesOpenOnThePhone()
        workspacePagesOpenTheirIPhoneScreenOrTheMac()
        macOnlyAddressesAreLocal()
        typedTextReadsAsTheMacDoes()
        decodesTheDockAndAnOlderBackend()
        print("Dock destinations passed")
    }

    private static let team = "/teams/t1"

    private static func webPagesOpenOnThePhone() {
        let browser = DockDestination(href: "\(team)/browser?url=x", url: "https://example.com/a", kind: "team.browser")
        precondition(browser == .web(URL(string: "https://example.com/a")!))
        // A Browser tab with no page yet is the phone's own blank browser, not a Mac page.
        precondition(DockDestination(href: "\(team)/browser", url: nil, kind: "team.browser") == .newBrowser)
        // Only web addresses: anything else never loads in the phone's browser.
        precondition(DockDestination(href: "\(team)/browser", url: "file:///etc/hosts", kind: "team.browser") == .newBrowser)
    }

    private static func workspacePagesOpenTheirIPhoneScreenOrTheMac() {
        precondition(DockDestination(href: "\(team)/plans", url: nil, kind: nil) == .plans)
        precondition(DockDestination(href: "\(team)/runtimes", url: nil, kind: nil) == .runtimes)
        precondition(DockDestination(href: "\(team)/integrations", url: nil, kind: nil) == .connectors)
        precondition(DockDestination(href: "\(team)/agent/ses_1", url: nil, kind: nil) == .chat(sessionId: "ses_1"))
        precondition(DockDestination(href: "", url: nil, kind: "team.desktop") == .desktop)
        precondition(DockDestination(href: "\(team)/files", url: nil, kind: nil) == .onMac(page: "team.files", href: "\(team)/files"))
        precondition(DockDestination(href: "", url: nil, kind: "team.dashboards") == .onMac(page: "team.dashboards", href: nil))
        let items = DockWorkspaceItem.all(teamId: "t1", desktop: true)
        precondition(items.map(\.title) == [
            "Browser", "Files", "Local terminal", "Runtime terminal", "Plans", "Architecture", "Designs", "Dashboards", "Monitoring", "Desktop",
        ])
        // The runtime terminal is its own path on the Mac, not the local one.
        precondition(items[3].destination == .onMac(page: "team.terminal", href: "/teams/t1/terminal/runtime"))
        precondition(!DockWorkspaceItem.all(teamId: "t1", desktop: false).contains { $0.page == "team.desktop" })
    }

    private static func macOnlyAddressesAreLocal() {
        for local in ["http://localhost:3000/", "http://127.0.0.1:5173", "http://192.168.1.20/", "http://10.0.0.2", "http://172.20.1.1", "http://mac.local:8080", "http://[::1]:3000"] {
            precondition(DockDestination.isLocal(URL(string: local)!), local)
        }
        for remote in ["https://example.com", "http://172.32.0.1", "https://8.8.8.8"] {
            precondition(!DockDestination.isLocal(URL(string: remote)!), remote)
        }
    }

    private static func typedTextReadsAsTheMacDoes() {
        precondition(DockDestination.address("localhost:3000")?.absoluteString == "http://localhost:3000")
        precondition(DockDestination.address("127.0.0.1:5173/app")?.absoluteString == "http://127.0.0.1:5173/app")
        precondition(DockDestination.address("example.com/docs")?.absoluteString == "https://example.com/docs")
        precondition(DockDestination.address("999.1.1.1") == nil)
        precondition(DockDestination.address("plans") == nil)
        precondition(DockDestination.addressOrSearch("open plans")?.absoluteString == "https://www.google.com/search?q=open%20plans")
        precondition(DockDestination.addressOrSearch("   ") == nil)
    }

    private static func decodesTheDockAndAnOlderBackend() {
        let json = #"{"tabs":[{"id":"t","kind":"team.terminal","title":"Local terminal","href":"/teams/t1/terminal"}],"activeTabId":"t","recent":[{"href":"/teams/t1/runtimes","title":"Runtimes"}]}"#
        let dock = try! JSONDecoder().decode(DockState.self, from: Data(json.utf8))
        precondition(dock.tabs.first?.destination == .onMac(page: "team.terminal", href: "/teams/t1/terminal"))
        precondition(dock.recent.first?.destination == .runtimes)
    }
}
