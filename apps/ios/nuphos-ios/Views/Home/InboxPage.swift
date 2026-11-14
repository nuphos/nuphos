import SwiftUI

/// The desktop's Inbox ("Needs your input"): every open question across the
/// viewer's conversations, grouped by the Bot or Task that asked, one line
/// each. Picking one opens it in `InboxQuestionView`: beside the list when
/// wide, pushed over it on iPhone.
struct InboxPage: View {
    let inbox: OpenQuestions?
    /// The window's, not a column's: a split view's columns report compact.
    @Environment(\.horizontalSizeClass) private var sizeClass

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
                                    .font(Theme.Text.body)
                                    .foregroundStyle(Theme.heading)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                    .accessibilityIdentifier("inbox.row")
                            }
                        } header: {
                            InboxSource(question: group[0])
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                // Wide, a question is always open beside the list.
                .onChange(of: sizeClass == .regular ? inbox.selected == nil : false, initial: true) { _, empty in
                    if empty { inbox.selected = inbox.groups.first?.first?.id }
                }
            }
        } else {
            ProgressView().tint(Theme.muted)
        }
    }
}

/// Who asked: a Bot's face or a Task's runtime mark, and its name.
struct InboxSource: View {
    let question: BotQuestion

    var body: some View {
        HStack(spacing: 8) {
            AgentAvatar(agentId: question.sessionId, runtime: question.runtime, size: 20, showBadge: false)
            Text(question.title)
                .font(Theme.Text.label.weight(.semibold))
                .foregroundStyle(Theme.heading)
                .lineLimit(1)
        }
        .textCase(nil)
    }
}
