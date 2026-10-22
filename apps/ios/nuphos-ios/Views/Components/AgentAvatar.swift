import SwiftUI

/// Stable Agent identity, with the current Runtime over its lower-right corner.
struct AgentAvatar: View {
    let agentId: String
    let runtime: String?
    var size: CGFloat = 24
    @AppStorage(BotAvatars.enabledKey) private var enabled = true

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            if enabled {
                Image(BotAvatars.asset(for: agentId))
                    .resizable().scaledToFit()
                    .frame(width: size, height: size, alignment: .topLeading)
                mark(size: size <= 24 ? 9 : 12)
                    .padding(1)
                    .background(Theme.canvas, in: Circle())
            } else {
                mark(size: 16).frame(width: size, height: size)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder private func mark(size: CGFloat) -> some View {
        if let runtime, runtime != "nuphos" {
            BrandLogo(name: RuntimeInstance.Provider.logo(runtime), size: size)
                .foregroundStyle(Theme.heading)
        } else {
            Image(systemName: "message").font(.system(size: size))
                .frame(width: size, height: size).foregroundStyle(Theme.muted)
        }
    }
}
