import SwiftUI

/// A Task row: its runtime on a tile, the title, then a dot-separated meta line,
/// with its state in the gutter.
struct ConversationRow<Accessory: View>: View {
    let conversation: AgentConversation
    /// Threads a folded parent hides; the row shows the most pressing of their states.
    var hidden: [AgentConversation] = []
    var depth = 0
    /// The thread count, under the time.
    @ViewBuilder var accessory: Accessory
    @Environment(AgentStore.self) private var store
    private var observations: RuntimeObservations { store.observations }
    private var team: String { conversation.teamId ?? store.selectedTeam?.id ?? "" }
    private var observation: RuntimeObservation? { observations.value(team: team, session: conversation.sessionId) }
    private var indicator: ConversationIndicator { indicator(for: conversation) }
    private var shownIndicator: ConversationIndicator {
        ([conversation] + hidden).map(indicator(for:)).max { $0.urgency < $1.urgency } ?? .none
    }

    private func indicator(for row: AgentConversation) -> ConversationIndicator { store.indicator(for: row, team: team) }

    var body: some View {
        ListRow(title: conversation.displayTitle, time: conversation.lastActiveAt, depth: depth) {
            switch shownIndicator {
            case .waiting:
                ListRowMetrics.dot(Theme.attention).accessibilityLabel("Needs your input")
            case .turn:
                ProgressView()
                    .controlSize(.mini)
                    .tint(Theme.muted)
                    .accessibilityLabel("Running")
            case .background:
                ListRowMetrics.dot(Theme.warning).accessibilityLabel("Background task running")
            case .unread:
                ListRowMetrics.dot(Theme.unread).accessibilityLabel("Unread reply")
            case .none:
                if conversation.isNativeRuntime, observation?.unavailable != false {
                    LucideIcon("circle-alert")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                        .accessibilityLabel("Runtime status unavailable")
                } else if observation?.paused == true {
                    LucideIcon("circle-alert")
                        .font(.footnote)
                        .foregroundStyle(Theme.muted)
                        .accessibilityLabel(observation?.status ?? String(localized: "Automatic continuation paused"))
                }
            }
        } avatar: {
            // A Task row, Bot or not, leads with its runtime, never a face (#1691).
            RuntimeMark(runtime: conversation.agentRuntime, size: 22)
                .frame(width: ListRowMetrics.avatar, height: ListRowMetrics.avatar)
                .background(Theme.sunken, in: Circle())
                .opacity(conversation.owner?.deactivated == true ? 0.5 : 1)
        } detail: {
            Text(meta)
                .foregroundStyle(indicator == .waiting ? Theme.attention : Theme.preview)
                .lineLimit(1)
        } accessory: {
            accessory
        }
    }

    private var meta: String {
        var parts: [String] = []
        if indicator == .waiting {
            parts.append(String(localized: "Needs your input"))
        } else if [.turn, .background].contains(indicator) || observation?.paused == true {
            parts.append(observation?.status ?? String(localized: "Working…"))
        }
        if let origin = conversation.activitySource?.origin, origin != "nuphos", origin != "unknown" {
            parts.append(origin.capitalized)
        }
        parts.append(RuntimeInstance.Provider.detail(conversation.agentRuntime, instance: conversation.runtimeLabel))
        return parts.joined(separator: " · ")
    }
}

extension ConversationRow where Accessory == EmptyView {
    init(conversation: AgentConversation, hidden: [AgentConversation] = []) {
        self.init(conversation: conversation, hidden: hidden) { EmptyView() }
    }
}

/// The Bots and Tasks row, laid out as Messages lays out a chat: the state in a
/// leading gutter, so the time and chevron never move; the avatar; then the title
/// with its time and chevron over the detail. Bots and Tasks share its columns.
struct ListRow<Gutter: View, Avatar: View, Detail: View, Accessory: View>: View {
    let title: String
    let time: Date
    var depth = 0
    /// A spinner in place of the chevron while the row's chat is made.
    var busy = false
    @ViewBuilder var gutter: Gutter
    @ViewBuilder var avatar: Avatar
    @ViewBuilder var detail: Detail
    @ViewBuilder var accessory: Accessory

    var body: some View {
        HStack(spacing: 0) {
            // Held open when empty, so a state never moves the row.
            Color.clear.frame(width: ListRowMetrics.gutter).overlay { gutter }
            HStack(spacing: 13) {
                // The text sets the row's height; the avatar centres on it, so a
                // Task's one meta line keeps the shorter pitch.
                Color.clear.frame(width: ListRowMetrics.avatar).overlay {
                    avatar.frame(width: ListRowMetrics.avatar, height: ListRowMetrics.avatar)
                }
                VStack(alignment: .leading, spacing: 1.5) {
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        Text(title)
                            .font(.headline)
                            .foregroundStyle(Theme.heading)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(HistoryTime.stamp(time))
                            .font(.footnote.monospacedDigit())
                            .foregroundStyle(Theme.stamp)
                            .lineLimit(1)
                        Group {
                            if busy { ProgressView().controlSize(.mini) } else { Image(systemName: "chevron.forward") }
                        }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.stamp)
                        .padding(.leading, 11.2)
                        .accessibilityHidden(true)
                    }
                    HStack(spacing: 8) {
                        detail
                            .font(.subheadline)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        // Drawn at its size, but never taller than the line it ends.
                        accessory.frame(maxHeight: 18)
                    }
                }
            }
            .padding(.leading, CGFloat(depth) * ThreadTree.indent)
        }
        .padding(.top, 12)
        .padding(.bottom, 14.5)
        .contentShape(Rectangle())
    }
}

enum ListRowMetrics {
    static let avatar: CGFloat = 45
    /// The state's column, before the avatar.
    static let gutter: CGFloat = 26

    /// A state in the gutter: unread, or waiting for the viewer.
    static func dot(_ color: Color) -> some View {
        Circle().fill(color).frame(width: 10.7, height: 10.7)
    }
}

/// Which agent answers in a conversation, as the desktop sidebar's
/// `RuntimeChatIcon` shows it: the provider's mark for a runtime, a message
/// glyph for the built-in agent. An unknown provider leaves the space empty.
/// It sits at the head of the meta line, so
/// the trailing indicators can come and go without moving it.
struct RuntimeMark: View {
    let runtime: String?
    var size: CGFloat = 14

    var body: some View {
        Group {
            if runtime == "nuphos" {
                LucideIcon("message-circle").font(.system(size: size))
                    .frame(width: size, height: size)
            } else {
                BrandLogo(name: RuntimeInstance.Provider.logo(runtime), size: size)
            }
        }
        .foregroundStyle(Theme.muted)
        .accessibilityHidden(true)
    }
}

/// Avatar for a conversation owner, which is a lighter record than
/// `NuphosUser`.
struct OwnerAvatar: View {
    let owner: AgentConversation.Owner?
    var size: CGFloat = 28

    var body: some View {
        AvatarView(
            user: NuphosUser(
                id: owner?.id ?? "",
                email: owner?.email ?? "",
                name: owner?.name ?? "",
                username: "",
                avatarURL: owner?.avatarURL ?? ""
            ),
            size: size
        )
    }
}

#Preview {
    List {
        ConversationRow(conversation: AgentConversation(
            sessionId: "1", title: "Check the staging cluster", messageCount: 14,
            createdAt: .now.addingTimeInterval(-86400 * 3), lastActiveAt: .now.addingTimeInterval(-3600 * 5),
            owner: .init(id: "u", name: "Bruce Wayne", email: "bruce@example.com", avatarURL: nil, deactivated: nil),
            tokenUsage: .init(costUsd: 0.42)
        ))
        ConversationRow(conversation: AgentConversation(
            sessionId: "2", title: "", firstMessage: "why is the api pod restarting", messageCount: 0,
            createdAt: .now, lastActiveAt: .now
        ))
    }
    .listStyle(.plain)
}
