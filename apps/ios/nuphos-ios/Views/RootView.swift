import SwiftUI

/// Picks the screen for the current auth state.
struct RootView: View {
    @Environment(AuthSession.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    private let stepUp = StepUpPrompt.shared

    var body: some View {
        Group {
            switch session.state {
            case .restoring:
                SplashView()
            case .signedOut, .signingIn:
                LoginView().id(session.generation)
            case .signedIn(let user):
                if session.aiConsentAccepted {
                    HomeView(user: user).id(session.generation)
                } else {
                    AIConsentView(user: user).id(session.generation)
                }
            }
        }
        .background(Theme.canvas.ignoresSafeArea())
        .animation(.easeInOut(duration: 0.25), value: isSignedIn)
        .task { await session.restore() }
        // nuphos.ai's "Open in Nuphos" hands the page over as nuphos://open.
        .onOpenURL { PushNotifications.shared.open($0) }
        .onChange(of: scenePhase, initial: true) { _, phase in
            Analytics.shared.setActive(phase == .active)
        }
        .task(id: "\(session.generation)/\(isSignedIn)") {
            if isSignedIn { await session.activatePush() }
        }
        #if os(iOS) && !NUPHOS_SHARE_EXTENSION
        // A request that needs a recent code waits on this sheet (StepUp.swift).
        .onAppear { stepUp.present = presentStepUp }
        #endif
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

#if os(iOS) && !NUPHOS_SHARE_EXTENSION
/// Over whatever is on screen, settings sheets included: a SwiftUI sheet on the
/// root view would not show while another sheet is up.
@MainActor private func presentStepUp(_ prompt: StepUpPrompt) {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        .first { $0.activationState == .foregroundActive }
    guard var top = scene?.keyWindow?.rootViewController else { return prompt.cancel() }
    while let next = top.presentedViewController { top = next }
    top.present(UIHostingController(rootView: StepUpSheet(prompt: prompt)), animated: true)
}
#endif
