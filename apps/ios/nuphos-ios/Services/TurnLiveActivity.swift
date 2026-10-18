#if os(iOS)
import ActivityKit
import Foundation

/// Puts a running turn on the Lock Screen and in the Dynamic Island. The app
/// only starts it (or returns it to Running); the backend ends it over APNs,
/// so it finishes correctly while the app is suspended.
enum TurnLiveActivity {
    static func show(sessionId: String, teamId: String, title: String, agent: String?, runtime: String?,
                     startedAt: Date?, authToken: String) {
        let running = ActivityContent(state: TurnActivityAttributes.ContentState(phase: .running), staleDate: nil)
        if let activity = Activity<TurnActivityAttributes>.activities.first(where: {
            $0.attributes.sessionId == sessionId && $0.activityState == .active
        }) {
            if activity.content.state != running.state { Task { await activity.update(running) } }
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = TurnActivityAttributes(
            sessionId: sessionId, title: title,
            logo: agent == nil || agent == "nuphos" ? "NuphosMark" : RuntimeInstance.Provider.logo(agent),
            runtime: runtime, startedAt: startedAt ?? .now,
            url: SessionLink.url(teamId: teamId, sessionId: sessionId)
        )
        guard let activity = try? Activity.request(attributes: attributes, content: running, pushType: .token) else { return }
        Task {
            for await data in activity.pushTokenUpdates {
                let token = data.map { String(format: "%02x", $0) }.joined()
                try? await AgentChatAPI.registerLiveActivity(
                    token: authToken,
                    activity: .init(token: token, teamId: teamId, sessionId: sessionId,
                                    environment: PushNotifications.environment)
                )
            }
        }
    }
}
#endif
