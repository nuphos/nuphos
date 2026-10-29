#if os(iOS)
import ActivityKit
import Foundation

/// The app's one Live Activity. A running turn puts its conversation on the
/// card, starting the card when there is none. Everything after that comes
/// from the backend over APNs, which follows the runtime's own status.
enum TurnLiveActivity {
    private typealias Card = TurnActivityAttributes.ContentState

    /// Token and conversation pairs already sent to the backend.
    private static var registered: Set<String> = []

    private static var card: Activity<TurnActivityAttributes>? {
        Activity<TurnActivityAttributes>.activities.first { $0.activityState == .active }
    }

    /// At launch: one card at most, the one the app keeps updating.
    static func dropExtras() {
        for activity in Activity<TurnActivityAttributes>.activities where activity.id != card?.id {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }

    static func show(sessionId: String, teamId: String, title: String, authToken: String) {
        let session = TurnActivityAttributes.Session(id: sessionId, teamId: teamId, title: title, phase: .running)
        if let activity = card {
            var state = activity.content.state
            if !state.sessions.contains(session) {
                state.put(session)
                Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
            }
            register(session, on: activity, authToken: authToken)
            return
        }
        // Only an ended card can be left; this turn's card takes its place.
        dropExtras()
        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              let activity = try? Activity.request(
                  attributes: TurnActivityAttributes(),
                  content: ActivityContent(state: Card(sessions: [session], more: 0, active: 1), staleDate: nil),
                  pushType: .token
              ) else { return }
        Task {
            for await _ in activity.pushTokenUpdates {
                for session in activity.content.state.sessions where session.phase.isActive {
                    register(session, on: activity, authToken: authToken)
                }
            }
        }
    }

    /// Tells the backend this card lists the conversation; without a token
    /// yet, the token's arrival does it.
    private static func register(_ session: TurnActivityAttributes.Session, on activity: Activity<TurnActivityAttributes>,
                                 authToken: String) {
        guard let data = activity.pushToken else { return }
        let token = data.map { String(format: "%02x", $0) }.joined()
        let key = token + session.id
        guard registered.insert(key).inserted else { return }
        Task {
            do {
                try await AgentChatAPI.registerLiveActivity(
                    token: authToken,
                    activity: .init(token: token, teamId: session.teamId, sessionId: session.id,
                                    environment: PushNotifications.environment)
                )
            } catch {
                registered.remove(key)
            }
        }
    }
}
#endif
