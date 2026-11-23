import SwiftUI

/// The desktop's Inbox ("Needs your input"): every open question across the
/// viewer's Bots and Tasks, grouped by the one that asked, one line each.
/// Picking one opens it in `InboxQuestionView`: beside the list when wide,
/// pushed over it on iPhone. Snoozed questions wait in a section of their own below.
struct InboxPage: View {
    @Environment(AgentStore.self) private var store
    let inbox: OpenQuestions?
    /// The question opens beside the list. The window's size class, not this column's: a split
    /// view's sidebar reports compact.
    let wide: Bool
    @State private var showWorkspaceSetup = false

    /// Between a group and the screen's edge.
    fileprivate static let margin: CGFloat = 16

    var body: some View {
        content
            .padding(.top, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .refreshable { await inbox?.refresh() }
            .sheet(isPresented: $showWorkspaceSetup) { WorkspaceSetupSheet() }
    }

    @ViewBuilder
    private var content: some View {
        if store.phase == .loaded, store.selectedTeam == nil {
            SetupEmptyState(title: "No team yet", message: "Your Inbox will show requests from your team once you join one.", actionTitle: "Set up a team") { showWorkspaceSetup = true }
        } else if let inbox, inbox.loaded {
            if inbox.list.isEmpty {
                VStack(spacing: 16) {
                    LucideIcon("inbox", size: 32)
                        .foregroundStyle(Theme.muted)
                        .accessibilityHidden(true)
                    Text("You're all caught up")
                        .font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
                    Text("When a Bot or task needs you to decide something, it shows up here. Answer it and it leaves the Inbox.")
                        .font(.callout).foregroundStyle(Theme.body).multilineTextAlignment(.center)
                }
                .padding(24).frame(maxWidth: 400)
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            } else {
                // On iPhone the list's selection pushes the question. Wide, a tap opens it beside the
                // list, and its fill marks it: the system's selection would ring it on iPad.
                List(selection: wide ? nil : Bindable(inbox).selected) {
                    ForEach(inbox.groups, id: \.[0].sourceId) { group in
                        Section {
                            ForEach(group) { question in
                                HStack(spacing: 8) {
                                    // A Bot's group names the Task that asked after the question, as on Desktop.
                                    (Text(question.request.question).foregroundStyle(Theme.heading)
                                        + Text(verbatim: question.bot == nil ? "" : " · \(question.title)").foregroundStyle(Theme.faint))
                                        .font(.system(size: 15))
                                        .lineLimit(1)
                                        .truncationMode(.tail)
                                    // On iPhone a row pushes its question.
                                    if !wide {
                                        Spacer(minLength: 0)
                                        LucideIcon("chevron-right")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(Theme.faint)
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
                                // Wide only: on iPhone even an idle tap gesture keeps the list's selection from pushing.
                                .simultaneousGesture(TapGesture().onEnded { inbox.selected = question.id },
                                                     including: wide ? .all : .subviews)
                                .accessibilityIdentifier("inbox.row")
                                // Wide, VoiceOver says the tap opens it; on iPhone the list's selection does.
                                .accessibilityAddTraits(wide ? .isButton : [])
                            }
                        } header: {
                            InboxSource(question: group[0])
                                .listRowInsets(EdgeInsets(top: 0, leading: Self.margin + 4, bottom: 6, trailing: Self.margin))
                        }
                    }
                    if !inbox.snoozed.isEmpty { snoozed(inbox) }
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
            }
        } else {
            ProgressView().tint(Theme.muted)
        }
    }
}

extension InboxPage {
    /// The snoozed questions, each with when it comes back and Unsnooze to bring it back now.
    /// They open nothing: a snoozed question is answered from its chat, or once it is back.
    fileprivate func snoozed(_ inbox: OpenQuestions) -> some View {
        Section {
            ForEach(inbox.snoozed) { question in
                HStack(spacing: 8) {
                    Text(question.request.question)
                        .font(.system(size: 15))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let until = question.snoozedDate {
                        Text(Snooze.returnTime(until)).font(.system(size: 13)).foregroundStyle(Theme.faint)
                    }
                    Button("Unsnooze") { Task { await inbox.snooze(question, until: nil) } }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.heading)
                        .frame(minHeight: 44)
                        .buttonStyle(.borderless)
                }
                .listRowInsets(EdgeInsets(top: 0, leading: Self.margin + 14, bottom: 0, trailing: Self.margin + 14))
                .listRowBackground(InboxRowBackground(
                    first: question.id == inbox.snoozed.first?.id, last: question.id == inbox.snoozed.last?.id, selected: false))
                .listRowSeparator(.hidden)
                .selectionDisabled()
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("inbox.snoozed")
            }
        } header: {
            Text("Snoozed")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.body)
                .textCase(nil)
                .listRowInsets(EdgeInsets(top: 0, leading: Self.margin + 4, bottom: 6, trailing: Self.margin))
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
            .fill(selected ? Theme.selected : Theme.surface)
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
            AgentAvatar(agentId: question.sourceId, runtime: question.bot?.agentRuntime ?? question.runtime, size: 18, showBadge: false)
            Text(question.bot?.displayTitle ?? question.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.body)
                .lineLimit(1)
        }
        .textCase(nil)
    }
}
