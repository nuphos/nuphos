import SwiftUI

/// `ConversationAccessState` in the desktop's `api/agent-types.ts`: who in the
/// team may read without an invite, and each person invited. Whoever may use
/// the computer the session runs on replies, invited or not.
struct SessionAccess: Decodable, Equatable {
    enum General: String, Decodable, CaseIterable {
        /// `reply` is a chat's only: in a session, reply follows its computer.
        case onlyInvited = "none", view, reply

        var title: LocalizedStringKey {
            switch self {
            case .onlyInvited: "Only people invited"
            case .view: "Team can view"
            case .reply: "Team can view and reply"
            }
        }
    }

    struct Participant: Decodable, Identifiable, Equatable {
        let id: String
        let name: String
        let email: String
        let avatarURL: String?
        let deactivated: Bool?
        let isOwner: Bool
        /// `owner`, `reply`, or `view` for someone who cannot use the session's computer yet.
        let role: String?

        var user: NuphosUser { NuphosUser(id: id, email: email, name: name, username: "", avatarURL: avatarURL ?? "") }

        var canReply: Bool { role != "view" }
    }

    var generalAccess: General
    var participants: [Participant]
}
