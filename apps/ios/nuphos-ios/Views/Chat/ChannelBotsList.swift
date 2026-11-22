import SwiftUI

/// A group chat's Bots, each with whether it can reply now.
struct ChannelBotsList: View {
    let agents: [ChannelAgent]

    var body: some View {
        NavigationStack {
            List(agents) { agent in
                HStack(spacing: 8) {
                    Text(agent.title).foregroundStyle(Theme.heading).lineLimit(1)
                    Spacer()
                    if let tag = agent.presence?.tag {
                        Circle().fill(tag.tone.color).frame(width: 8, height: 8)
                        Text(tag.word).font(.caption).foregroundStyle(Theme.muted)
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
