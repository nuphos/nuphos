import SwiftUI

/// A Bot wears its face; a Task (no face) shows its runtime mark (#1691).
struct AgentAvatar: View {
    let agentId: String
    let runtime: String?
    var size: CGFloat = 24
    @AppStorage(BotAvatars.enabledKey, store: BotAvatars.defaults) private var enabled = true

    var body: some View {
        Group {
            if enabled, let face = BotFaces.shared.face(for: agentId) {
                // A face this build doesn't ship falls back to the one the id derives, as on Desktop.
                Image(BotAvatars.asset(named: face) ?? BotAvatars.asset(for: agentId)).resizable().scaledToFit()
            } else {
                RuntimeMark(runtime: runtime, size: 20)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
