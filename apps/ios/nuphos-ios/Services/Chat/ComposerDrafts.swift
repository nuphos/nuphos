import Foundation

/// Unsent composer text per conversation, kept while the app runs and dropped on sign-out.
enum ComposerDrafts {
    private struct Key: Hashable { let identity: String; let team: String; let session: String }
    private static var drafts: [Key: String] = [:]

    private static func key(_ team: String, _ session: String, _ identity: String) -> Key { Key(identity: identity, team: team, session: session) }

    static func text(team: String, session: String, identity: String = "") -> String {
        drafts[key(team, session, identity)] ?? ""
    }

    static func set(_ text: String, team: String, session: String, identity: String = "") {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            drafts.removeValue(forKey: key(team, session, identity))
        } else {
            drafts[key(team, session, identity)] = text
        }
    }

    /// The composer text to show after the selected team changes. Text typed
    /// before any team resolved belongs to the first team, not to nobody.
    static func switchTeam(visible: String, session: String, from old: String, to new: String, identity: String = "") -> String {
        guard old.isEmpty, !visible.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return text(team: new, session: session, identity: identity)
        }
        set("", team: old, session: session, identity: identity)
        set(visible, team: new, session: session, identity: identity)
        return visible
    }

    static func clear() {
        drafts = [:]
    }
}
