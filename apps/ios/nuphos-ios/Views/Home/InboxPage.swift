import SwiftUI

/// The desktop's Inbox ("Needs your input"): every open question across the
/// viewer's Bots and Tasks, grouped by the one that asked, one line each.
/// Picking one opens it in `InboxQuestionView`: beside the list when wide,
/// pushed over it on iPhone.
struct InboxPage: View {
    let inbox: OpenQuestions?
    /// The window's, not a column's: a split view's columns report compact.
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .refreshable { await inbox?.refresh() }
    }

    @ViewBuilder
    private var content: some View {
        if let inbox, inbox.loaded {
            if inbox.list.isEmpty {
                ContentUnavailableView(
                    "You're all caught up",
                    systemImage: "tray",
                    description: Text("When an agent needs you to decide something, it shows up here. Answer it and it leaves the Inbox."))
            } else {
                List(selection: Bindable(inbox).selected) {
                    ForEach(inbox.groups, id: \.[0].sessionId) { group in
                        Section {
                            ForEach(group) { question in
                                Text(question.request.question)
                                    .font(.system(size: 15))
                                    .foregroundStyle(Theme.heading)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                    .listRowInsets(EdgeInsets(top: 0, leading: 14, bottom: 0, trailing: 14))
                                    // Wide, the open question stays marked; a custom background hides the system's.
                                    .listRowBackground(wide && inbox.selected == question.id ? Theme.selected : Theme.chatSurface)
                                    .listRowSeparatorTint(Theme.hairline)
                                    .accessibilityIdentifier("inbox.row")
                            }
                        } header: {
                            InboxSource(question: group[0])
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .listSectionSpacing(wide ? 16 : 18)
                .environment(\.defaultMinListRowHeight, wide ? 44 : 46)
                .scrollContentBackground(.hidden)
                // Wide, a question is always open beside the list.
                .onChange(of: wide ? inbox.selected == nil : false, initial: true) { _, empty in
                    if empty { inbox.selected = inbox.groups.first?.first?.id }
                }
                // On iPhone the last answer goes back to the list: it says so here.
                .overlay(alignment: .bottom) {
                    if !wide, inbox.selected == nil { InboxToast(inbox: inbox).padding(.bottom, 24) }
                }
            }
        } else {
            ProgressView().tint(Theme.muted)
        }
    }
}

/// A group's header: the Bot's face or the Task's runtime mark, and its name.
struct InboxSource: View {
    let question: BotQuestion

    var body: some View {
        HStack(spacing: 8) {
            AgentAvatar(agentId: question.sessionId, runtime: question.runtime, size: 18, showBadge: false)
            Text(question.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.body)
                .lineLimit(1)
        }
        .textCase(nil)
    }
}

/// "Answered "…"" for a few seconds after an answer.
struct InboxToast: View {
    let inbox: OpenQuestions

    var body: some View {
        if let answered = inbox.toast {
            Text("Answered “\(answered)”")
                .font(.system(size: 14))
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.horizontal, 18)
                .frame(height: 44)
                .background(Color(hex: 0x18181B), in: Capsule())
                .padding(.horizontal, 20)
                .accessibilityIdentifier("inbox.toast")
                .transition(.opacity.combined(with: .move(edge: .bottom)))
                .task(id: answered) {
                    try? await Task.sleep(for: .seconds(4))
                    if !Task.isCancelled, inbox.toast == answered { withAnimation { inbox.toast = nil } }
                }
        }
    }
}
