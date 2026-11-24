import SwiftUI

/// The desktop a `computer` question hands over, live and view-only above its I'm done and Skip:
/// never a stored picture. Take over opens it full screen, already taken over; closing that hands
/// it back. A stopped Box or a dropped stream shows the desktop's own connecting or failed state.
struct ComputerPreview: View {
    let teamId: String
    /// The conversation that asked: its display is reached through it.
    let sessionId: String
    let desktop: AgentConversation.ComputerDesktop
    /// The Bot whose computer it is, named in the sign-in note.
    let bot: String

    @Environment(AgentStore.self) private var store
    @State private var live: DesktopSession?
    @State private var held: DesktopSession?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Label(String(localized: "Computer · \(desktop.title)"), systemImage: "display")
                    .foregroundStyle(Theme.muted)
                    .lineLimit(1)
                    .accessibilityIdentifier("computer.title")
                Spacer(minLength: 8)
                if live?.phase == .live {
                    HStack(spacing: 5) {
                        Circle().fill(Theme.success).frame(width: 6, height: 6)
                        Text("Live").fontWeight(.medium)
                    }
                    .foregroundStyle(Theme.success)
                    .accessibilityIdentifier("computer.liveMark")
                }
            }
            .font(Theme.Text.caption)
            screen
            Button { takeOver() } label: {
                Label("Take over", systemImage: "cursorarrow")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Theme.surface)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(Theme.heading, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(live?.phase != .live)
            .opacity(live?.phase == .live ? 1 : 0.45)
            .accessibilityIdentifier("computer.takeOver")
            Label(String(localized: "You sign in on \(desktop.title), \(bot)’s computer, and it stays signed in there. The site may email you about a sign-in from a new device."),
                  systemImage: "checkmark.shield")
                .font(Theme.Text.caption)
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("computer.signInNote")
        }
        .onAppear {
            if live == nil { live = session(takingOver: false) }
            live?.start()
        }
        .onDisappear { live?.stop() }
        // One stream at a time: the card's view rests while the desktop is held.
        .onChange(of: held == nil) { _, closed in if closed { live?.start() } }
        .desktop($held)
    }

    private func takeOver() {
        live?.stop()
        held = session(takingOver: true)
    }

    private func session(takingOver: Bool) -> DesktopSession {
        let session = DesktopSession(teamId: teamId, sessionId: sessionId, token: store.token, display: desktop.display)
        session.takesOver = takingOver
        return session
    }

    /// The desktop's own shape once it shows; 16:10 until then.
    private var ratio: CGFloat {
        guard let size = live?.screenSize, size.width > 0, size.height > 0 else { return 16 / 10 }
        return size.width / size.height
    }

    private var screen: some View {
        ZStack {
            Color.black
            if let live {
                DesktopCanvas(desktop: live).allowsHitTesting(false)
                switch live.phase {
                case .live: EmptyView()
                case .connecting: ProgressView().tint(.white)
                case .failed(let message):
                    VStack(spacing: 10) {
                        Text(message).font(Theme.Text.caption).multilineTextAlignment(.center)
                        Button("Try again") { live.retry() }.font(Theme.Text.caption.weight(.semibold))
                    }
                    .foregroundStyle(.white.opacity(0.8))
                    .padding(16)
                }
            }
        }
        .aspectRatio(ratio, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("computer.live")
    }
}
