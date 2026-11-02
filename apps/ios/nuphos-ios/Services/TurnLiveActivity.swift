#if os(iOS)
import ActivityKit
import Foundation

/// The app's one Live Activity. The backend starts it over APNs when a
/// conversation the person watches runs, adds later ones to it and keeps every
/// row on the runtime's own status. The app only hands over the tokens for that.
enum TurnLiveActivity {
    /// Token and conversation pairs already sent to the backend.
    private static var registered: Set<String> = []
    /// Cards whose token updates are being followed.
    private static var followed: Set<String> = []

    private static var card: Activity<TurnActivityAttributes>? {
        Activity<TurnActivityAttributes>.activities.first { $0.activityState == .active }
    }

    /// At launch: keeps one card, and sends the backend the token that starts
    /// a card and the token of every card, including ones started later.
    static func observe() {
        for activity in Activity<TurnActivityAttributes>.activities where activity.id != card?.id {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
        Activity<TurnActivityAttributes>.activities.forEach(follow)
        // A newly started card replaces any other: its conversations are the current ones.
        Task {
            for await activity in Activity<TurnActivityAttributes>.activityUpdates {
                for other in Activity<TurnActivityAttributes>.activities where other.id != activity.id {
                    Task { await other.end(nil, dismissalPolicy: .immediate) }
                }
                follow(activity)
            }
        }
        Task {
            for await data in Activity<TurnActivityAttributes>.pushToStartTokenUpdates {
                PushNotifications.shared.didRegister(liveActivityStartToken: hex(data))
            }
        }
    }

    private static func follow(_ activity: Activity<TurnActivityAttributes>) {
        guard followed.insert(activity.id).inserted else { return }
        Task {
            for await data in activity.pushTokenUpdates {
                for session in activity.content.state.sessions where session.phase.isActive {
                    register(session, token: hex(data))
                }
            }
        }
    }

    /// Tells the backend this card lists the conversation. Read from the
    /// Keychain: a card started over APNs wakes the app in the background.
    private static func register(_ session: TurnActivityAttributes.Session, token: String) {
        let key = token + session.id
        guard let authToken = Keychain.read(AuthSession.tokenKey), registered.insert(key).inserted else { return }
        Task {
            do {
                try await AgentChatAPI.registerLiveActivity(
                    token: authToken,
                    activity: .init(token: token, teamId: session.teamId, sessionId: session.id,
                                    environment: PushNotifications.environment, deviceId: PushNotifications.deviceId)
                )
            } catch {
                registered.remove(key)
            }
        }
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
#endif
