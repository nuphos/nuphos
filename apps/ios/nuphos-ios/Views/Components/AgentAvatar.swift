import SwiftUI

/// A Bot wears its face; a Task (no face) shows its runtime mark (#1691).
struct AgentAvatar: View {
    let agentId: String
    let runtime: String?
    var size: CGFloat = 24
    var showBadge = true
    @AppStorage(BotAvatars.enabledKey, store: BotAvatars.defaults) private var enabled = true

    var body: some View {
        Group {
            if enabled, let face = BotFaces.shared.face(for: agentId) {
                // A face this build doesn't ship falls back to the one the id derives, as on Desktop.
                Image(BotAvatars.asset(named: face) ?? BotAvatars.asset(for: agentId)).resizable().scaledToFit()
                    .overlay(alignment: .bottomTrailing) {
                        if showBadge {
                            AgentRuntimeBadge(runtime: runtime, size: size <= 24 ? 9 : 12)
                        }
                    }
            } else {
                RuntimeMark(runtime: runtime, size: min(size, 20))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Decorative mark shared with the group avatar's topmost badge layer.
struct AgentRuntimeBadge: View {
    let runtime: String?
    let size: CGFloat
    var body: some View {
        RuntimeMark(runtime: runtime, size: max(1, size - 2))
            .padding(1)
            .background(Theme.surface, in: Circle())
            .accessibilityHidden(true)
    }
}
