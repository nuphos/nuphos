import SwiftUI

/// The desktop a `computer` question hands over, live and view-only above its I'm done and Skip:
/// never a stored picture. Take over opens it full screen, already taken over; closing that hands
/// it back. A stopped Box or a dropped stream shows the desktop's own connecting or failed state.
struct ComputerPreview: View {
    let teamId: String
    /// The conversation that asked: its display is reached through it.
    let sessionId: String
    let desktop: AgentConversation.ComputerDesktop

    @Environment(AgentStore.self) private var store
    @State private var live: DesktopSession?
    @State private var held: DesktopSession?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(desktop.title, systemImage: "display")
                .font(Theme.Text.caption)
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
                .accessibilityIdentifier("computer.title")
            screen
            QuestionPill(title: String(localized: "Take over")) { held = session(takingOver: true) }
                .disabled(live?.phase != .live)
                .accessibilityIdentifier("computer.takeOver")
        }
        .onAppear {
            if live == nil { live = session(takingOver: false) }
            live?.start()
        }
        .onDisappear { live?.stop() }
        .desktop($held)
    }

    private func session(takingOver: Bool) -> DesktopSession {
        let session = DesktopSession(teamId: teamId, sessionId: sessionId, token: store.token, display: desktop.display)
        session.takesOver = takingOver
        return session
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
        .aspectRatio(16 / 10, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("computer.live")
    }
}
