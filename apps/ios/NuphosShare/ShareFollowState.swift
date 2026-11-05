/// Whether a conversation opened by Sharing polls and is read: only while it is
/// on screen, the extension is active, and the share may still act.
struct ShareFollowState: Equatable {
    var shown: Bool
    var active: Bool
    var permitted: Bool

    var isOpen: Bool { shown && active && permitted }
}
