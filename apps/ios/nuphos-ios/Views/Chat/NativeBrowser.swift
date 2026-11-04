import SwiftUI
import WebKit

/// A dock page opened on the phone itself, at the phone's own quality: scrolls and taps like
/// Safari, with nothing driven on the Mac. It uses the phone's own sign-ins, not the Mac's.
/// The Mac stays one menu away: show the tab there, or watch it live from there.
struct NativeBrowser: View {
    let session: ChatSession
    /// The page to open; nil opens a blank page with the address field ready.
    let url: URL?
    /// The Mac dock tab it mirrors, when it came from one.
    let tabId: String?
    var liveView: (String) -> Void
    var close: () -> Void

    @State private var page: WebPage
    @State private var address = ""
    @State private var bannerHidden = false
    @State private var notice: String?
    @FocusState private var editing: Bool

    init(session: ChatSession, url: URL?, tabId: String?, liveView: @escaping (String) -> Void, close: @escaping () -> Void) {
        self.session = session
        self.url = url
        self.tabId = tabId
        self.liveView = liveView
        self.close = close
        _page = State(initialValue: WebPage(proxy: MacPageProxy { [session] in try await session.dockFetch($0) }))
    }

    /// A page on the Mac itself or its network, fetched there.
    private var onMac: Bool { page.target.map(DockDestination.isLocal) ?? false }

    var body: some View {
        VStack(spacing: 0) {
            addressBar
            if page.loading { ProgressView(value: page.progress).progressViewStyle(.linear).tint(Theme.brand) }
            if page.target != nil, !bannerHidden { onMac ? AnyView(liveReloadBanner) : AnyView(signedOutBanner) }
            if onMac, let failure = page.failure { macPageFailure(failure) } else { WebPageView(page: page) }
            toolbar
        }
        .background(Theme.chatCanvas)
        .onAppear {
            if let url { page.load(url) } else { editing = true }
            address = url?.absoluteString ?? ""
        }
        .onChange(of: page.current) { _, current in if !editing { address = current?.absoluteString ?? address } }
        .alert("Couldn't reach your Mac", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(notice ?? "")
        }
    }

    private var addressBar: some View {
        HStack(spacing: 10) {
            Button("Done", action: close).accessibilityIdentifier("browser-done")
            TextField("Search or enter address", text: $address)
                .textFieldStyle(.plain)
                .keyboardType(.webSearch)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.go)
                .focused($editing)
                .onSubmit { if let target = DockDestination.addressOrSearch(address) { page.load(target) } }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.chatSurface))
                .accessibilityIdentifier("browser-address")
            Button("Reload", systemImage: page.loading ? "xmark" : "arrow.clockwise") {
                if page.loading { page.view.stopLoading() } else { page.view.reload() }
            }
            .labelStyle(.iconOnly)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var signedOutBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "person.crop.circle.badge.questionmark").foregroundStyle(Theme.muted)
            Text("Uses this iPhone's sign-ins, not your Mac's.")
                .font(Theme.Text.label)
                .foregroundStyle(Theme.body)
            Spacer(minLength: 4)
            if tabId != nil { Button("Show on Mac") { showOnMac() }.font(Theme.Text.label) }
            Button("Hide", systemImage: "xmark") { bannerHidden = true }
                .labelStyle(.iconOnly)
                .font(Theme.Text.label)
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Theme.chatSurface)
        .accessibilityIdentifier("browser-signed-out")
    }

    /// A Mac-only page comes through the Mac request by request; its dev server's live updates don't.
    private var liveReloadBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "macbook").foregroundStyle(Theme.muted)
            Text("Loaded from your Mac. Live reload doesn't update here; reload to see changes.")
                .font(Theme.Text.label)
                .foregroundStyle(Theme.body)
            Spacer(minLength: 4)
            Button("Hide", systemImage: "xmark") { bannerHidden = true }
                .labelStyle(.iconOnly)
                .font(Theme.Text.label)
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Theme.chatSurface)
        .accessibilityIdentifier("browser-live-reload")
    }

    private func macPageFailure(_ reason: String) -> some View {
        ContentUnavailableView {
            Label("Couldn't load this page from your Mac", systemImage: "macbook")
        } description: {
            Text(reason)
        } actions: {
            if let tabId {
                Button("Live view on Mac") { liveView(tabId) }.buttonStyle(.borderedProminent)
                Button("Show on Mac") { showOnMac() }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var toolbar: some View {
        HStack {
            Button("Back", systemImage: "chevron.backward") { page.view.goBack() }.disabled(!page.canGoBack)
            Spacer()
            Button("Forward", systemImage: "chevron.forward") { page.view.goForward() }.disabled(!page.canGoForward)
            Spacer()
            if let current = page.current {
                ShareLink(item: current) { Image(systemName: "square.and.arrow.up") }
            } else {
                Image(systemName: "square.and.arrow.up").foregroundStyle(Theme.muted)
            }
            Spacer()
            Menu {
                if let tabId {
                    Button("Show on Mac", systemImage: "macbook") { showOnMac() }
                    Button("Live view on Mac", systemImage: "rectangle.on.rectangle") { liveView(tabId) }
                    Button("Close tab", systemImage: "xmark.square", role: .destructive) { closeTab(tabId) }
                } else {
                    Text("Not in your Mac's dock")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityIdentifier("browser-menu")
        }
        .labelStyle(.iconOnly)
        .font(.title3)
        .padding(.horizontal, 24)
        .padding(.vertical, 10)
        .background(Theme.chatSurface)
    }

    private func showOnMac() {
        guard let tabId else { return }
        Task {
            do { try await session.focusDockTab(tabId) } catch { notice = error.localizedDescription }
        }
    }

    private func closeTab(_ id: String) {
        Task {
            do {
                try await session.closeDockTab(id)
                close()
            } catch { notice = error.localizedDescription }
        }
    }
}

/// The phone's own page, watched for the bar: address, history, progress.
@Observable
@MainActor
final class WebPage: NSObject, WKNavigationDelegate {
    let view: WKWebView
    /// What was asked for, before any redirect: whether it is Mac-only is decided by it.
    private(set) var target: URL?
    /// The page's own address: a Mac-only page reads as itself, not as the phone's scheme.
    private(set) var current: URL?
    /// Why the last page failed to load, if it did.
    private(set) var failure: String?
    private(set) var canGoBack = false
    private(set) var canGoForward = false
    private(set) var loading = false
    private(set) var progress = 0.0
    @ObservationIgnored private var observers: [NSKeyValueObservation] = []

    init(proxy: MacPageProxy) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.setURLSchemeHandler(proxy, forURLScheme: MacPageScheme.http)
        configuration.setURLSchemeHandler(proxy, forURLScheme: MacPageScheme.https)
        view = WKWebView(frame: .zero, configuration: configuration)
        view.allowsBackForwardNavigationGestures = true
        super.init()
        view.navigationDelegate = self
        observers = [
            view.observe(\.url) { [weak self] web, _ in
                Task { @MainActor in self?.current = web.url.map { MacPageScheme.macURL($0) ?? $0 } }
            },
            view.observe(\.canGoBack) { [weak self] web, _ in Task { @MainActor in self?.canGoBack = web.canGoBack } },
            view.observe(\.canGoForward) { [weak self] web, _ in Task { @MainActor in self?.canGoForward = web.canGoForward } },
            view.observe(\.isLoading) { [weak self] web, _ in Task { @MainActor in self?.loading = web.isLoading } },
            view.observe(\.estimatedProgress) { [weak self] web, _ in Task { @MainActor in self?.progress = web.estimatedProgress } },
        ]
    }

    /// Opens a page: a Mac-only one under the phone's scheme, so the Mac fetches it.
    func load(_ url: URL) {
        target = url
        current = url
        failure = nil
        view.load(URLRequest(url: MacPageScheme.phoneURL(url) ?? url))
    }

    /// A link from a Mac-only page to its own absolute address stays on the Mac.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url, let phone = MacPageScheme.phoneURL(url) else { return .allow }
        load(MacPageScheme.macURL(phone) ?? url)
        return .cancel
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        failure = error.localizedDescription
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        failure = nil
    }
}

private struct WebPageView: UIViewRepresentable {
    let page: WebPage

    func makeUIView(context: Context) -> WKWebView { page.view }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
