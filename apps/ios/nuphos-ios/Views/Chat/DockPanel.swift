import SwiftUI

/// The conversation's dock, as the Mac shows it beside the chat: its desktop, and its browser
/// tabs, whoever opened them. A tab's page stays on that computer: tapping one watches it live
/// from there, and its menu can show it on the Mac's own screen instead.
struct DockPanel: View {
    let session: ChatSession
    var openDesktop: () -> Void
    var openTab: (BrowserTab) -> Void
    var close: () -> Void

    @State private var tabs: [BrowserTab]?
    @State private var loadError: String?
    @State private var focusing: String?
    @State private var focusError: String?
    /// Where no desktop opens, what a tap did, said once.
    @State private var shownOnMac = false

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
            List {
                if session.canOpenDesktop {
                    Section("Desktop") {
                        Button(action: openDesktop) {
                            Label(session.runtimeDisplayName ?? "Desktop", systemImage: "display")
                        }
                        .accessibilityIdentifier("dock-desktop")
                    }
                }
                Section {
                    browser
                } header: {
                    Text("Browser")
                } footer: {
                    if shownOnMac { Text("Shown on your computer.") }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await load() }
        }
        .background(Theme.chatSurface)
        .task { await load() }
        .alert("Couldn't show the tab", isPresented: Binding(get: { focusError != nil }, set: { if !$0 { focusError = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(focusError ?? "")
        }
    }

    @ViewBuilder
    private var browser: some View {
        if let tabs {
            if tabs.isEmpty {
                Text("No browser tabs in this chat's dock yet. Pages opened there show up here.")
                    .font(Theme.Text.secondary)
                    .foregroundStyle(Theme.muted)
            }
            ForEach(tabs) { tab in
                Button { openTab(tab) } label: { row(tab) }
                    .disabled(focusing != nil)
                    .contextMenu {
                        Button("Show on Mac", systemImage: "macbook") { Task { await show(tab) } }
                    }
                    .accessibilityIdentifier("dock-tab-\(tab.id)")
            }
        } else if let loadError {
            Label(loadError, systemImage: "exclamationmark.triangle")
                .font(Theme.Text.secondary)
                .foregroundStyle(Theme.muted)
        } else {
            ProgressView().frame(maxWidth: .infinity)
        }
    }

    private func row(_ tab: BrowserTab) -> some View {
        HStack(spacing: 12) {
            AsyncImage(url: tab.favicon) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                Image(systemName: "globe").foregroundStyle(Theme.muted)
            }
            .frame(width: 20, height: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(tab.title.isEmpty ? tab.host : tab.title)
                    .foregroundStyle(Theme.heading)
                    .lineLimit(1)
                Text(tab.host)
                    .font(Theme.Text.label)
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if focusing == tab.id { ProgressView() }
        }
        .contentShape(Rectangle())
    }

    private func load() async {
        do {
            tabs = try await session.browserTabs()
            loadError = nil
        } catch {
            if tabs == nil { loadError = error.localizedDescription }
        }
    }

    private func show(_ tab: BrowserTab) async {
        focusing = tab.id
        defer { focusing = nil }
        do {
            try await session.focus(tab)
        } catch {
            focusError = error.localizedDescription
            return
        }
        if session.canOpenDesktop { openDesktop() } else { shownOnMac = true }
    }
}
