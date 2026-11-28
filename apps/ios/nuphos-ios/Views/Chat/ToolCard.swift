import Charts
import SwiftUI
import WebKit

struct ToolCardView: View {
    let card: ToolCard
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            Group {
            switch card {
            case .artifact(_, let title, let kind, _):
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.body.weight(.medium)).foregroundStyle(Theme.heading).lineLimit(2)
                        Text(Self.label(kind)).font(.footnote).foregroundStyle(Theme.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    openBadge
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
            case .chart(_, let chart):
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(chart.title).font(.body.weight(.medium)).foregroundStyle(Theme.heading).lineLimit(2)
                            if let description = chart.description {
                                Text(description).font(.footnote).foregroundStyle(Theme.muted).lineLimit(2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        openBadge
                    }
                    ChartBody(chart: chart).frame(height: 180)
                }
                .padding(16)
            }
            }
            .background(Theme.raised, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.outline))
            .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .frame(maxWidth: 520, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier(card.isChart ? "chart.card" : "artifact.card")
    }

    private var openBadge: some View {
        HStack(spacing: 4) {
            Text("Open")
            LucideIcon("panel-right", size: 12)
        }
        .font(.caption)
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 8).frame(height: 28)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.outline))
    }

    static func label(_ kind: String) -> String {
        switch kind {
        case "html": "HTML"
        case "markdown": String(localized: "Document")
        case "svg": "SVG"
        default: String(localized: "Code")
        }
    }
}

private extension ToolCard {
    var isChart: Bool { if case .chart = self { true } else { false } }
}

/// The card opened over the chat. The screen presents it: a row in the transcript cannot.
struct ToolCardPanel: View {
    let card: ToolCard
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { dismiss() } label: { LucideIcon("x") }
                            .accessibilityLabel("Close")
                            .accessibilityIdentifier("toolCard.close")
                    }
                }
        }
        .accessibilityIdentifier("toolCard.panel")
    }

    private var title: String {
        switch card {
        case .artifact(_, let title, _, _): title
        case .chart(_, let chart): chart.title
        }
    }

    @ViewBuilder
    private var content: some View {
        switch card {
        case .artifact(_, _, "html", let content):
            ArtifactWebView(html: content, open: { openURL($0) }).ignoresSafeArea(edges: .bottom)
        case .artifact(_, _, "svg", let content):
            ArtifactWebView(html: "<body style=\"margin:0\">\(content)</body>", open: { openURL($0) }).ignoresSafeArea(edges: .bottom)
        case .artifact(_, _, "markdown", let content):
            ScrollView { AssistantMarkdown(text: content).padding(16).frame(maxWidth: .infinity, alignment: .leading) }
        case .artifact(_, _, _, let content):
            ScrollView([.vertical, .horizontal]) {
                Text(content).font(.system(.footnote, design: .monospaced)).textSelection(.enabled).padding(16)
            }
        case .chart(_, let chart):
            VStack(alignment: .leading, spacing: 12) {
                if let description = chart.description { Text(description).font(.subheadline).foregroundStyle(Theme.muted) }
                ChartBody(chart: chart)
            }
            .padding(16)
        }
    }
}

private struct ChartBody: View {
    let chart: ToolCard.Chart

    var body: some View {
        Charts.Chart {
            ForEach(Array(chart.rows.enumerated()), id: \.offset) { _, row in
                ForEach(chart.series, id: \.key) { series in
                    if let y = row[series.key]?.numberValue {
                        let x = row[chart.xKey].map(Self.text) ?? ""
                        switch chart.type {
                        case "line":
                            LineMark(x: .value(chart.xKey, x), y: .value(series.label, y)).foregroundStyle(by: .value("Series", series.label))
                        case "area":
                            AreaMark(x: .value(chart.xKey, x), y: .value(series.label, y)).foregroundStyle(by: .value("Series", series.label))
                        default:
                            BarMark(x: .value(chart.xKey, x), y: .value(series.label, y)).foregroundStyle(by: .value("Series", series.label))
                                .position(by: .value("Series", series.label))
                        }
                    }
                }
            }
        }
        .chartLegend(chart.series.count > 1 ? .visible : .hidden)
    }

    private static func text(_ value: JSONValue) -> String {
        switch value {
        case .string(let s): s
        case .number(let n): n.rounded() == n ? String(Int(n)) : String(n)
        case .bool(let b): String(b)
        default: ""
        }
    }
}

/// An artifact's page: its scripts run so it draws, in a store that keeps nothing, with no
/// bridge to the app. A link leaves for the browser instead of replacing the page.
private struct ArtifactWebView: UIViewRepresentable {
    let html: String
    let open: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(open: open) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.accessibilityIdentifier = "artifact.page"
        let viewport = html.range(of: #"<meta[^>]*name\s*=\s*["']?viewport"#, options: [.regularExpression, .caseInsensitive]) == nil
            ? "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" : ""
        view.loadHTMLString("<meta charset=\"utf-8\">\(viewport)\(html)", baseURL: nil)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let open: (URL) -> Void
        init(open: @escaping (URL) -> Void) { self.open = open }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, let url = action.request.url else { return .allow }
            if url.fragment != nil, url.absoluteString.hasPrefix("about:") { return .allow }
            if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { open(url) }
            return .cancel
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") { open(url) }
            return nil
        }
    }
}
