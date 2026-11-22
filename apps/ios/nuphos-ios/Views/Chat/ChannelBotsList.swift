import SwiftUI

/// A group chat's Bots, each with whether it can reply now.
struct ChannelBotsList: View {
    let agents: [ChannelAgent]

    var body: some View {
        NavigationStack {
            List(agents) { agent in
                HStack(spacing: 10) {
                    AgentAvatar(agentId: agent.sessionId, runtime: agent.provider, size: 28)
                    Text(agent.title).foregroundStyle(Theme.heading).lineLimit(1)
                    Spacer()
                    if let tag = agent.presence?.tag {
                        HStack(spacing: 6) {
                            Circle().fill(tag.tone.color).frame(width: 6, height: 6)
                            Text(tag.word).font(.caption).foregroundStyle(Theme.muted)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("channel.bot.\(agent.sessionId)")
            }
            .navigationTitle("Bots")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
        }
        // As tall as its rows; a long list can still be pulled up.
        .presentationDetents([.height(CGFloat(120 + 52 * agents.count)), .large])
        .presentationDragIndicator(.visible)
    }
}

private extension BotPresence.Tone {
    var color: Color {
        switch self {
        case .ready: Theme.success
        case .waiting: Theme.attention
        case .down: .red
        }
    }
}
