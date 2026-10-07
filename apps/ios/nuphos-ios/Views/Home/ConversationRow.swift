import SwiftUI

/// The desktop `HistoryConversationRow`: owner avatar, title, then a
/// dot-separated meta line.
struct ConversationRow: View {
    let conversation: AgentConversation
    var pinned = false
    @Environment(AgentStore.self) private var store
    private let observations = RuntimeObservations.shared
    private var team: String { conversation.teamId ?? store.selectedTeam?.id ?? "" }
    private var observation: RuntimeObservation? { observations.value(team: team, session: conversation.sessionId) }
    private var indicator: ConversationIndicator {
        let unread = ConversationUnread.shared.contains(team: team, session: conversation.sessionId)
        guard conversation.isNativeRuntime else { return conversation.activeRun != nil ? .turn : unread ? .unread : .none }
        return ConversationIndicator(observation, at: observations.now, unread: unread)
    }

    var body: some View {
        HStack(spacing: 12) {
            OwnerAvatar(owner: conversation.owner, size: 36)
                .opacity(conversation.owner?.deactivated == true ? 0.5 : 1)
                .overlay(alignment: .bottomTrailing) {
                    if pinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 15, height: 15)
                            .background(Circle().fill(Theme.muted))
                            .overlay(Circle().stroke(Theme.canvas, lineWidth: 1.5))
                            .offset(x: 3, y: 3)
                            .accessibilityLabel("Pinned")
                    }
                }

            VStack(alignment: .leading, spacing: 3) {
                Text(conversation.displayTitle)
                    .font(Theme.Text.body.weight(.medium))
                    .foregroundStyle(Theme.heading)
                    .lineLimit(1)

                HStack(spacing: 5) {
                    RuntimeMark(runtime: conversation.isNativeRuntime ? conversation.agentRuntime : nil)
                    Text(meta)
                        .font(Theme.Text.label)
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            switch indicator {
            case .turn:
                ProgressView()
                    .controlSize(.small)
                    .tint(Theme.muted)
                    .accessibilityLabel("Agent is working")
            case .background:
                Circle().fill(Theme.warning).frame(width: 7, height: 7).accessibilityLabel("Background task running")
            case .unread:
                Circle().fill(Theme.unread).frame(width: 7, height: 7).accessibilityLabel("Unread reply")
            case .none:
                EmptyView()
            }
            if conversation.isNativeRuntime, observation?.unavailable != false {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(Theme.muted)
                    .accessibilityLabel("Runtime status unavailable")
            } else if observation?.paused(at: observations.now) == true {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(Theme.muted)
                    .accessibilityLabel(observation?.status(at: observations.now) ?? "Automatic continuation paused")
            }
            if conversation.isArchived {
                Image(systemName: "archivebox")
                    .font(Theme.Text.label)
                    .foregroundStyle(Theme.muted)
                    .accessibilityLabel("Archived")
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }

    private var meta: String {
        let status = [.turn, .background].contains(indicator) || observation?.paused(at: observations.now) == true
        var parts = [status ? (observation?.status(at: observations.now) ?? "Working…") : HistoryTime.format(conversation.lastActiveAt)]
        if let origin = conversation.activitySource?.origin, origin != "nuphos", origin != "unknown" {
            parts.append(origin.capitalized)
        }
        if let label = conversation.runtimeLabel, !label.isEmpty {
            parts.append(label)
        }
        return parts.joined(separator: " · ")
    }
}

/// Which agent answers in a conversation, as the desktop sidebar's
/// `RuntimeChatIcon` shows it: the provider's mark for a runtime, a message
/// glyph for the built-in agent. It sits at the head of the meta line, so
/// the trailing indicators can come and go without moving it.
struct RuntimeMark: View {
    /// `agentRuntime` for a runtime-backed chat, absent for the built-in one.
    let runtime: String?

    var body: some View {
        Group {
            if let runtime {
                BrandLogo(name: RuntimeInstance.Provider.logo(runtime), size: 12)
            } else {
                Image(systemName: "message")
                    .font(Theme.Text.caption)
                    .frame(width: 12, height: 12)
            }
        }
        .foregroundStyle(Theme.muted)
        .accessibilityLabel(RuntimeInstance.Provider.name(runtime ?? "nuphos"))
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
