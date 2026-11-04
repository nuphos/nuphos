import SwiftUI

/// The conversation's dock, mirrored from the Mac: its tabs in a strip, each closable there,
/// and the Mac's New Tab page (search, Recent, Favorites, Workspace, connected sources). A web
/// page opens in the phone's own browser; a page the iPhone has opens its screen; the rest
/// open on the Mac.
struct DockPanel: View {
    let session: ChatSession
    var openDesktop: () -> Void
    /// A web page in the phone's browser: its address (nil for a blank one) and its dock tab.
    var openWeb: (URL?, String?) -> Void
    /// A screen the iPhone has: Plans, Runtimes or Connectors.
    var openScreen: (DockDestination) -> Void
    var close: () -> Void

    @Environment(\.openURL) private var openURL
    @Environment(ConnectorsStore.self) private var connectors: ConnectorsStore?
    @State private var dock: DockState?
    @State private var favorites: [SidebarFavorites.Entry] = []
    @State private var loadError: String?
    @State private var query = ""
    @State private var notice: String?
    @State private var problem: String?
    @FocusState private var searching: Bool

    /// The Mac's New Tab shows this many Recent rows before a search.
    private static let recentRows = 6

    var body: some View {
        // Its own header, not a NavigationStack: a stack's toolbar would join the chat's bar.
        VStack(spacing: 0) {
            HStack {
                Text("Dock").font(.headline).foregroundStyle(Theme.heading)
                Spacer()
                Button("Close", systemImage: "xmark", action: close)
                    .labelStyle(.iconOnly)
                    .foregroundStyle(Theme.body)
                    .accessibilityIdentifier("dock-close")
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            tabStrip
            newTabPage
            // Below the list, not in it: a scrolled list would hide what the tap just did.
            if let notice {
                HStack(spacing: 8) {
                    Label(notice, systemImage: "macbook").font(Theme.Text.secondary).foregroundStyle(Theme.body)
                    Spacer(minLength: 4)
                    Button("Dismiss", systemImage: "xmark") { self.notice = nil }.labelStyle(.iconOnly).foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(Theme.chatCanvas)
                .accessibilityIdentifier("dock-notice")
            }
        }
        .background(Theme.chatSurface)
        .task { await load() }
        .alert("Couldn't reach your Mac", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(problem ?? "")
        }
    }

    // MARK: - Tab strip

    private var tabStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(dock?.tabs ?? []) { tab in chip(tab) }
                Button("New tab", systemImage: "plus") { searching = true }
                    .labelStyle(.iconOnly)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Theme.chatCanvas))
                    .accessibilityIdentifier("dock-new-tab")
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)
        }
    }

    private func chip(_ tab: DockTab) -> some View {
        let front = tab.id == dock?.activeTabId
        return HStack(spacing: 6) {
            Button { open(tab.destination, tab: tab.id, title: tab.title) } label: {
                HStack(spacing: 6) {
                    icon(tab.destination, kind: tab.kind)
                    Text(tab.title.isEmpty ? "Untitled" : tab.title)
                        .font(Theme.Text.label)
                        .foregroundStyle(front ? Theme.heading : Theme.body)
                        .lineLimit(1)
                        .frame(maxWidth: 140, alignment: .leading)
                }
            }
            .accessibilityIdentifier("dock-tab-\(tab.id)")
            Button("Close \(tab.title)", systemImage: "xmark") { Task { await closeTab(tab) } }
                .labelStyle(.iconOnly)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.muted)
                .accessibilityIdentifier("dock-close-tab-\(tab.id)")
        }
        .padding(.leading, 10)
        .padding(.trailing, 8)
        .frame(height: 32)
        .background(Capsule().fill(front ? Theme.chatCanvas : Theme.chatCanvas.opacity(0.5)))
    }

    // MARK: - New Tab

    private var newTabPage: some View {
        List {
            Section {
                TextField("Search destinations or history", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($searching)
                    .onSubmit { if let url = DockDestination.addressOrSearch(query) { openAddress(url) } }
                    .accessibilityIdentifier("dock-search")
            }
            if let loadError, dock == nil {
                Section { Label(loadError, systemImage: "exclamationmark.triangle").font(Theme.Text.secondary).foregroundStyle(Theme.muted) }
            }
            if query.trimmingCharacters(in: .whitespaces).isEmpty { groups } else { results }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await load() }
    }

    @ViewBuilder
    private var groups: some View {
        let recent = Array((dock?.recent ?? []).prefix(Self.recentRows))
        if !recent.isEmpty {
            Section("Recent") { ForEach(recent) { row($0.title, detail: $0.url, destination: $0.destination, id: "recent-\($0.href)") } }
        }
        if !favorites.isEmpty {
            Section("Favorites") {
                ForEach(Array(favorites.enumerated()), id: \.offset) { _, entry in
                    row(entry.label, detail: nil, destination: favoriteDestination(entry), id: "favorite-\(entry.label)")
                }
            }
        }
        Section("Workspace") {
            ForEach(DockWorkspaceItem.all(teamId: session.teamId, desktop: session.canOpenDesktop)) { item in
                row(item.title, detail: nil, destination: item.destination, id: "workspace-\(item.id)", systemImage: item.systemImage)
            }
        }
        ForEach(connectors?.inventory?.boundSections ?? [], id: \.category) { section in
            Section(section.category.title) {
                ForEach(section.connectors) { connector in
                    ForEach(connectors?.inventory?.bindings(for: connector) ?? []) { binding in
                        row(binding.label, detail: connector.title, destination: .connectors, id: "connector-\(binding.id)", systemImage: "link")
                    }
                }
            }
        }
    }

    /// While typing: every destination and history entry that matches, with the address first.
    @ViewBuilder
    private var results: some View {
        let terms = query.lowercased().split(separator: " ").map(String.init)
        let matches: (String) -> Bool = { text in terms.allSatisfy { text.lowercased().contains($0) } }
        Section {
            if let url = DockDestination.addressOrSearch(query) {
                let label = DockDestination.address(query) != nil ? "Open \(url.absoluteString)" : "Search for “\(query)”"
                row(label, detail: nil, destination: .web(url), id: "address", systemImage: "globe")
            }
            ForEach((dock?.recent ?? []).filter { matches($0.title + " " + ($0.url ?? "")) }) {
                row($0.title, detail: $0.url, destination: $0.destination, id: "recent-\($0.href)")
            }
            ForEach(DockWorkspaceItem.all(teamId: session.teamId, desktop: session.canOpenDesktop).filter { matches($0.title) }) { item in
                row(item.title, detail: "Workspace", destination: item.destination, id: "workspace-\(item.id)", systemImage: item.systemImage)
            }
        }
    }

    private func row(_ title: String, detail: String?, destination: DockDestination, id: String, systemImage: String? = nil) -> some View {
        Button { open(destination, tab: nil, title: title) } label: {
            HStack(spacing: 12) {
                if let systemImage { Image(systemName: systemImage).foregroundStyle(Theme.muted).frame(width: 20) } else { icon(destination, kind: nil) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.heading).lineLimit(1)
                    if let detail { Text(detail).font(Theme.Text.label).foregroundStyle(Theme.muted).lineLimit(1) }
                }
                Spacer(minLength: 0)
                if case .onMac = destination { Image(systemName: "macbook").font(.caption).foregroundStyle(Theme.muted) }
            }
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("dock-row-\(id)")
    }

    @ViewBuilder
    private func icon(_ destination: DockDestination, kind: String?) -> some View {
        switch destination {
        case .web(let url):
            AsyncImage(url: Self.favicon(url)) { image in image.resizable().scaledToFit() } placeholder: {
                Image(systemName: "globe").foregroundStyle(Theme.muted)
            }
            .frame(width: 18, height: 18)
        default:
            Image(systemName: Self.symbol(destination, kind: kind)).foregroundStyle(Theme.muted).frame(width: 18)
        }
    }

    private static func favicon(_ url: URL) -> URL? {
        guard !DockDestination.isLocal(url), var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        parts.path = "/favicon.ico"
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }

    private static func symbol(_ destination: DockDestination, kind: String?) -> String {
        switch destination {
        case .web, .newBrowser: "globe"
        case .desktop: "display"
        case .plans: "list.bullet.clipboard"
        case .runtimes: "cpu"
        case .connectors: "link"
        case .chat: "bubble.left"
        case .onMac(let page, _):
            switch kind ?? page {
            case "team.terminal": "terminal"
            case "team.files": "folder"
            case "team.dashboards": "chart.xyaxis.line"
            case "team.monitoring": "waveform.path.ecg"
            default: "square.on.square"
            }
        }
    }

    private func favoriteDestination(_ entry: SidebarFavorites.Entry) -> DockDestination {
        if let session = entry.sessionId { return .chat(sessionId: session) }
        if let href = entry.href {
            let url = URLComponents(string: href)?.queryItems?.first { $0.name == "url" }?.value
            return DockDestination(href: href, url: url, kind: nil)
        }
        return DockDestination(href: "", url: nil, kind: entry.key)
    }

    // MARK: - Actions

    private func load() async {
        async let favorites = try? session.favorites()
        do {
            dock = try await session.dock()
            loadError = nil
        } catch {
            if dock == nil { loadError = error.localizedDescription }
        }
        self.favorites = await favorites ?? self.favorites
        if let connectors, connectors.inventory == nil { await connectors.load(teamId: session.teamId) }
    }

    private func open(_ destination: DockDestination, tab: String?, title: String) {
        notice = nil
        switch destination {
        case .web(let url):
            if tab != nil { openWeb(url, tab) } else { openAddress(url) }
        case .newBrowser: openWeb(nil, nil)
        case .desktop: openDesktop()
        case .plans, .runtimes, .connectors: openScreen(destination)
        case .chat(let id):
            if let link = URL(string: "https://nuphos.ai/teams/\(session.teamId)/agent/\(id)") { openURL(link) }
        case .onMac(let page, let href):
            Task { await openOnMac(page: page, href: href, tab: tab, title: title) }
        }
    }

    /// A web address from New Tab: a new tab in the Mac's dock too, so both strips show it.
    private func openAddress(_ url: URL) {
        Task {
            let id = try? await session.openDockTab(url: url)
            openWeb(url, id)
            await load()
        }
    }

    /// A page the iPhone doesn't have: brought forward on the Mac, opening it there if needed.
    private func openOnMac(page: String, href: String?, tab: String?, title: String) async {
        do {
            let id: String
            if let tab { id = tab } else { id = try await session.openDockTab(href: href, page: href == nil ? page : nil) }
            try await session.focusDockTab(id)
            notice = "\(title) isn't on iPhone yet. It's open on your Mac."
            await load()
        } catch {
            problem = error.localizedDescription
        }
    }

    /// Gone from the strip at once; put back if the Mac couldn't close it.
    private func closeTab(_ tab: DockTab) async {
        dock?.tabs.removeAll { $0.id == tab.id }
        do {
            try await session.closeDockTab(tab.id)
        } catch {
            problem = error.localizedDescription
            await load()
        }
    }
}

/// A dock page open in the phone's own browser, and the Mac dock tab it mirrors.
struct DockWeb: Identifiable {
    let id = UUID()
    let url: URL?
    let tabId: String?
}

extension DockDestination: Identifiable {
    var id: Self { self }
}

/// An iPhone screen opened from the dock, as the Mac opens the same page in a dock tab.
struct DockScreen: View {
    let destination: DockDestination
    @Environment(\.dismiss) private var dismiss
    @State private var page = HomePage.plans
    @State private var searching = false
    @State private var collapsed = false

    var body: some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch destination {
        case .plans: PlansPage(page: $page, isSearching: $searching, titleCollapsed: $collapsed).navigationTitle("Plans")
        case .runtimes: RuntimesPage().navigationTitle("Runtimes")
        default: ConnectorsPage().navigationTitle("Connectors")
        }
    }
}
