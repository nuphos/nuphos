#if os(iOS)
import ActivityKit
import Foundation

/// The app's one Live Activity. A running turn puts its conversation on the
/// card, starting the card when there is none. The backend keeps the card
/// current over APNs, so it moves on while the app is suspended; the app also
/// updates it when it sees a turn start or end for certain.
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

    /// Only for a turn that certainly ended; the backend's push covers the rest.
    static func finish(sessionId: String, phase: TurnActivityAttributes.Phase) {
        guard let activity = card else { return }
        var state = activity.content.state
        guard let session = state.sessions.first(where: { $0.id == sessionId && $0.phase.isActive }) else { return }
        state.put(.init(id: session.id, teamId: session.teamId, title: session.title, phase: phase))
        let content = ActivityContent(state: state, staleDate: nil)
        Task {
            if state.active > 0 {
                await activity.update(content)
            } else {
                await activity.end(content, dismissalPolicy: .after(.now.addingTimeInterval(30 * 60)))
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
