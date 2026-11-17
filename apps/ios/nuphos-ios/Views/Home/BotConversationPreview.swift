import SwiftUI

/// A read-only snapshot for the system context menu. Showing it never opens a
/// chat, creates a Bot's channel, starts polling, or marks a reply as read.
struct BotConversationPreview: View {
    let conversation: AgentConversation
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                if conversation.isChannel {
                    ChatIcon(faces: conversation.faces ?? [], title: title, size: 36)
                } else {
                    AgentAvatar(agentId: conversation.sessionId, runtime: conversation.agentRuntime, size: 36)
                }
                Text(title)
                    .font(Theme.Text.body.weight(.semibold))
                    .foregroundStyle(Theme.heading)
                    .lineLimit(2)
            }
            .padding(16)
            Divider()
            Group {
                if let message = conversation.previewLine, !message.isEmpty {
                    Text(message)
                        .font(Theme.Text.body)
                        .foregroundStyle(Theme.heading)
                        .lineLimit(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Theme.muted.opacity(0.10), in: RoundedRectangle(cornerRadius: 20))
                } else {
                    Text("No messages yet")
                        .font(Theme.Text.body)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(16)
        }
        .frame(idealWidth: 320, maxWidth: 360)
        .background(Theme.canvas)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("BotConversationPreview")
    }
}
