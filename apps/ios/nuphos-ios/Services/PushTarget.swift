import Foundation

/// A conversation a notification or a session link points at.
struct PushTarget: Equatable, Hashable, Identifiable {
    let teamId: String
    let sessionId: String
    let title: String
    var id: String { "\(teamId)/\(sessionId)" }

    init(teamId: String, sessionId: String, title: String = String(localized: "Task")) {
        self.teamId = teamId
        self.sessionId = sessionId
        self.title = title
    }

    nonisolated init?(userInfo: [AnyHashable: Any]) {
        guard let teamId = userInfo["teamId"] as? String, !teamId.isEmpty,
              let sessionId = userInfo["sessionId"] as? String, !sessionId.isEmpty else { return nil }
        self.teamId = teamId
        self.sessionId = sessionId
        let alert = (userInfo["aps"] as? [String: Any])?["alert"] as? [String: Any]
        title = alert?["title"] as? String ?? String(localized: "Task")
    }
}
