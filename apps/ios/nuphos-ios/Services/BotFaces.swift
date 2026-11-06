import Foundation
import Observation

/// The faces of Bots this app has seen, learned from every list it loads, so
/// any view that only knows an agent's ID (a message, a thread badge, a chat
/// member) shows a Bot's face and a Task's runtime mark (#1691).
@MainActor
@Observable
final class BotFaces {
    static let shared = BotFaces()

    private(set) var faces: [String: String] = [:]

    /// The face for `sessionId`, or nil when it is a Task or not known yet.
    func face(for sessionId: String) -> String? { faces[sessionId] }

    func learn(_ sessionId: String, avatar: String?) {
        guard faces[sessionId] != avatar else { return }
        faces[sessionId] = avatar
    }

    func learn(_ conversations: [AgentConversation]) {
        for conversation in conversations {
            learn(conversation.sessionId, avatar: conversation.isChannel ? nil : conversation.avatar)
            for face in conversation.faces ?? [] where face.agent != nil {
                learn(face.id, avatar: face.agent?.avatar)
            }
        }
    }
}
