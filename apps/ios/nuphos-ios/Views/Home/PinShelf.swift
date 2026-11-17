import SwiftUI

/// Desktop's `SidebarBotPins`: pinned Bots and chats as faces above Bots, in
/// the order of the favorites Desktop shares. A face carries its row's most
/// pressing state.
struct PinShelf: View {
    let pins: [AgentConversation]
    let open: (AgentConversation) -> Void
    @Environment(AgentStore.self) private var store

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 16) {
                ForEach(pins) { row in
                    PinContextTile(content: AnyView(tile(row)),
                        preview: AnyView(BotConversationPreview(conversation: row, title: store.title(of: row))),
                        identifier: "PinnedBot-\(row.sessionId)",
                        accessibilityLabel: store.title(of: row), accessibilityValue: statusLabel(row),
                        unpinTitle: row.isBot || row.botId != nil ? String(localized: "Unpin Bot") : String(localized: "Unpin"),
                        open: { open(row) }, unpin: { Task { await store.setPinned(false, row) } })
                        .frame(width: 76, height: 100)

                }
            }
            .padding(.horizontal, 16)
        }
        .defaultScrollAnchor(.center, for: .alignment)
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("PinnedBotsShelf")
    }

    private func tile(_ row: AgentConversation) -> some View {
        let title = store.title(of: row)
        return VStack(spacing: 6) {
            Group {
                if row.isChannel {
                    ChatIcon(faces: row.faces ?? [], title: title, size: 64)
                } else {
                    AgentAvatar(agentId: row.sessionId, runtime: row.agentRuntime, size: 64)
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
        .frame(width: 76, alignment: .top)
        .frame(minHeight: 100, alignment: .top)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func statusLabel(_ row: AgentConversation) -> String {
        let bot = row.isBot ? row : store.bot(of: row)
        let runs = bot.map { [$0] + store.threads(of: $0) } ?? []
        if runs.contains(where: \.isWaiting) { return String(localized: "Needs your input") }
        if runs.contains(where: store.inTurn) { return String(localized: "Running") }
        let team = row.teamId ?? store.selectedTeam?.id ?? ""
        return store.unread.contains(team: team, session: row.sessionId) ? String(localized: "Unread posts") : ""
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


/// Each face owns its UIKit interaction, including when hosted in a List header.
private struct PinContextTile: UIViewRepresentable {
    let content: AnyView
    let preview: AnyView
    let identifier: String
    let accessibilityLabel: String
    let accessibilityValue: String
    let unpinTitle: String
    let open: () -> Void
    let unpin: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> UIView {
        let host = UIHostingController(rootView: content)
        context.coordinator.host = host
        let view = host.view!
        view.backgroundColor = .clear
        view.isAccessibilityElement = true
        view.accessibilityIdentifier = identifier
        view.accessibilityLabel = accessibilityLabel
        view.accessibilityValue = accessibilityValue
        view.accessibilityTraits = .button
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tap)))
        view.addInteraction(UIContextMenuInteraction(delegate: context.coordinator))
        return view
    }
    func updateUIView(_ view: UIView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.host?.rootView = content
        view.accessibilityIdentifier = identifier
        view.accessibilityLabel = accessibilityLabel
        view.accessibilityValue = accessibilityValue
    }
    final class Coordinator: NSObject, UIContextMenuInteractionDelegate {
        var parent: PinContextTile
        var host: UIHostingController<AnyView>?
        init(_ parent: PinContextTile) { self.parent = parent }
        @objc func tap() { parent.open() }
        func contextMenuInteraction(_ interaction: UIContextMenuInteraction,
            configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? {
            UIContextMenuConfiguration(identifier: parent.identifier as NSString, previewProvider: {
                let controller = UIHostingController(rootView: self.parent.preview)
                controller.preferredContentSize = controller.sizeThatFits(in: CGSize(width: 320, height: 480))
                return controller
            }, actionProvider: { _ in
                UIMenu(children: [UIAction(title: self.parent.unpinTitle, image: UIImage(named: "lucide-pin-off")) { _ in
                    self.parent.unpin()
                }])
            })
        }
    }
}
