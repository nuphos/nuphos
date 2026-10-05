import SwiftUI

/// Picks the screen for the current auth state.
struct RootView: View {
    @Environment(AuthSession.self) private var session
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch session.state {
            case .restoring:
                SplashView()
            case .signedOut, .signingIn:
                LoginView()
            case .signedIn(let user):
                if session.aiConsentAccepted {
                    HomeView(user: user).id(user.id)
                } else {
                    AIConsentView(user: user).id(user.id)
                }
            }
        }
        .background(Theme.canvas.ignoresSafeArea())
        .animation(.easeInOut(duration: 0.25), value: isSignedIn)
        .task { await session.restore() }
        .onChange(of: scenePhase, initial: true) { _, phase in
            Analytics.shared.setActive(phase == .active)
        }
        .task(id: isSignedIn) {
            if isSignedIn, let token = session.token { await PushNotifications.shared.activate(authToken: token) }
        }
    }

    private var isSignedIn: Bool { session.user != nil }
}

/// Shown only while a saved session is being validated on launch.
private struct SplashView: View {
    var body: some View {
        ZStack {
            Theme.canvas.ignoresSafeArea()
            VStack(spacing: 20) {
                Image("NuphosMark")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(Theme.heading)
                    .frame(width: 72, height: 72)
                ProgressView().tint(Theme.muted)
            }
        }
    }
}
