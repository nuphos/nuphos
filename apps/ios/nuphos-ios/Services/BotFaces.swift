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
    /// The tint each face sits on, learned with it (#3504).
    private(set) var backgrounds: [String: String] = [:]

    /// The face for `sessionId`, or nil when it is a Task or not known yet.
    func face(for sessionId: String) -> String? { faces[sessionId] }

    /// The tint `sessionId`'s face sits on, or nil for none.
    func background(for sessionId: String) -> String? { backgrounds[sessionId] }

    func learn(_ sessionId: String, avatar: String?, background: String? = nil) {
        // A Task has no background.
        let background = avatar == nil ? nil : background
        if faces[sessionId] != avatar { faces[sessionId] = avatar }
        if backgrounds[sessionId] != background { backgrounds[sessionId] = background }
    }

    func learn(_ conversations: [AgentConversation]) {
        for conversation in conversations {
            if conversation.isChannel {
                learn(conversation.sessionId, avatar: nil)
            } else {
                learn(conversation.sessionId, avatar: conversation.avatar, background: conversation.avatarBackground)
            }
            for face in conversation.faces ?? [] where face.agent != nil {
                learn(face.id, avatar: face.agent?.avatar, background: face.agent?.avatarBackground)
            }
        }
    }
}
