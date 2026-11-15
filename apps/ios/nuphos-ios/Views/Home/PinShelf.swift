import SwiftUI

/// Desktop's `SidebarBotPins`: pinned Bots and chats as faces above Bots, in
/// the order of the favorites Desktop shares. A face carries its row's most
/// pressing state.
struct PinShelf: View {
    let pins: [AgentConversation]
    let open: (AgentConversation) -> Void
    @Environment(AgentStore.self) private var store

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 4)], spacing: 12) {
            ForEach(pins) { row in
                Button { open(row) } label: { tile(row) }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button { Task { await store.setPinned(false, row) } } label: {
                            Label(row.isBot || row.botId != nil ? "Unpin Bot" : "Unpin", systemImage: "pin.slash")
                        }
                    }
            }
        }
    }

    private func tile(_ row: AgentConversation) -> some View {
        let title = store.title(of: row)
        return VStack(spacing: 6) {
            Group {
                if row.isChannel {
                    ChatIcon(faces: row.faces ?? [], title: title, size: 52)
                } else {
                    AgentAvatar(agentId: row.sessionId, runtime: row.agentRuntime, size: 52)
                }
            }
            .overlay(alignment: .topTrailing) {
                if let color = status(row) {
                    Circle().fill(color).frame(width: 10, height: 10)
                        .overlay(Circle().stroke(Theme.canvas, lineWidth: 2))
                }
            }
            Text(title)
                .font(Theme.Text.caption)
                .foregroundStyle(Theme.heading)
                .lineLimit(2)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// A question from the Bot or what it dispatched, then a turn, then an unread reply.
    private func status(_ row: AgentConversation) -> Color? {
        let bot = row.isBot ? row : store.bot(of: row)
        let runs = bot.map { [$0] + store.threads(of: $0) } ?? []
        if runs.contains(where: \.isWaiting) { return Theme.attention }
        if runs.contains(where: store.inTurn) { return Theme.warning }
        let team = row.teamId ?? store.selectedTeam?.id ?? ""
        return store.unread.contains(team: team, session: row.sessionId) ? Theme.unread : nil
    }
}

/// A project on Tasks: the folder its Tasks work in, or No project.
struct ProjectRow: View {
    let project: AgentConversation

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: project.sessionId == ConversationNesting.projectPrefix + "none" ? "circle.dashed" : "folder")
                .font(.system(size: 17))
                .foregroundStyle(Theme.muted)
                .frame(width: 36, height: 28)
            Text(project.displayTitle)
                .font(Theme.Text.body.weight(.medium))
                .foregroundStyle(Theme.heading)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }
}
