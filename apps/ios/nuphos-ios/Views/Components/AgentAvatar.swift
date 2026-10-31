import SwiftUI

/// Stable conversation identity. Provider metadata lives beside the runtime name.
struct AgentAvatar: View {
    let agentId: String
    let runtime: String?
    var size: CGFloat = 24
    @AppStorage(BotAvatars.enabledKey) private var enabled = true

    var body: some View {
        Group {
            if enabled {
                Image(BotAvatars.asset(for: agentId)).resizable().scaledToFit()
            } else {
                RuntimeMark(runtime: runtime, size: 20)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
