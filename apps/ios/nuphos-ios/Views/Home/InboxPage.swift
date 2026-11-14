import SwiftUI

/// The desktop's Inbox ("Needs your input"): every open question across the
/// viewer's Bots and Tasks, grouped by the one that asked, one line each.
/// Picking one opens it in `InboxQuestionView`: beside the list when wide,
/// pushed over it on iPhone.
struct InboxPage: View {
    let inbox: OpenQuestions?
    /// The question opens beside the list. The window's size class, not this column's: a split
    /// view's sidebar reports compact.
    let wide: Bool

    /// Between a group and the screen's edge.
    fileprivate static let margin: CGFloat = 16

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
                // On iPhone the list's selection pushes the question. Wide, a tap opens it beside the
                // list, and its fill marks it: the system's selection would ring it on iPad.
                List(selection: wide ? nil : Bindable(inbox).selected) {
                    ForEach(inbox.groups, id: \.[0].sessionId) { group in
                        Section {
                            ForEach(group) { question in
                                HStack(spacing: 8) {
                                    Text(question.request.question)
                                        .font(.system(size: 15))
                                        .foregroundStyle(Theme.heading)
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                    // On iPhone a row pushes its question.
                                    if !wide {
                                        Spacer(minLength: 0)
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Theme.muted)
                                    }
                                }
                                .listRowInsets(EdgeInsets(top: 0, leading: Self.margin + 14, bottom: 0, trailing: Self.margin + 14))
                                .listRowBackground(InboxRowBackground(
                                    first: question.id == group.first?.id, last: question.id == group.last?.id,
                                    // Wide, the open question stays marked.
                                    selected: wide && inbox.selected == question.id))
                                .listRowSeparator(.hidden)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                                // Alongside, not instead of, the list's own tap that pushes on iPhone.
                                .simultaneousGesture(TapGesture().onEnded { if wide { inbox.selected = question.id } })
                                .accessibilityAddTraits(.isButton)
                                .accessibilityIdentifier("inbox.row")
                            }
                        } header: {
                            InboxSource(question: group[0])
                                .listRowInsets(EdgeInsets(top: 0, leading: Self.margin + 4, bottom: 6, trailing: Self.margin))
                        }
                    }
                }
                // Grouped, not inset: the groups' corners and margins are drawn by InboxRowBackground.
                .listStyle(.grouped)
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

/// One row of a group: the group's rounded corners on its first and last row, and the
/// divider under every row but the last.
private struct InboxRowBackground: View {
    let first: Bool
    let last: Bool
    let selected: Bool

    var body: some View {
        UnevenRoundedRectangle(
            topLeadingRadius: first ? 14 : 0, bottomLeadingRadius: last ? 14 : 0,
            bottomTrailingRadius: last ? 14 : 0, topTrailingRadius: first ? 14 : 0, style: .continuous)
            .fill(selected ? Theme.selected : Theme.chatSurface)
            .overlay(alignment: .bottom) {
                if !last { Theme.separator.frame(height: 0.5).padding(.leading, 14) }
            }
            .padding(.horizontal, InboxPage.margin)
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

/// "Answered "…"" with Undo, while the answer is held.
struct InboxToast: View {
    let inbox: OpenQuestions

    var body: some View {
        if let answered = inbox.toast {
            HStack(spacing: 12) {
                Text("Answered “\(answered)”")
                    .font(.system(size: 14))
                    .lineLimit(1)
                Button("Undo") { withAnimation(.snappy) { inbox.undo() } }
                    .font(.system(size: 14, weight: .semibold))
                    .padding(.horizontal, 12)
                    .frame(height: 32)
                    .background(.white.opacity(0.16), in: Capsule())
                    .buttonStyle(.plain)
            }
            .foregroundStyle(.white)
            .padding(.leading, 18)
            .padding(.trailing, 6)
            .frame(height: 44)
            .background(Color(hex: 0x18181B), in: Capsule())
            .padding(.horizontal, 20)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("inbox.toast")
            .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
    }
}
