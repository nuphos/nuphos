import Foundation

enum ConversationNestingTests {
    static func run() {
        nestsThreadsUnderTheirParent()
        foldingHidesTheSubtree()
        anUnlistedOrPinnedParentLeavesTheRowTopLevel()
        aRefreshKeepsLaterRowsInPlace()
        print("Conversation nesting passed")
    }

    private static func row(_ id: String, parent: String? = nil) -> AgentConversation {
        AgentConversation(
            sessionId: id, title: id, messageCount: 1, createdAt: .now, lastActiveAt: .now, parentSessionId: parent
        )
    }

    private static let tree = [
        row("child-b", parent: "parent"), row("grandchild", parent: "child-a"),
        row("child-a", parent: "parent"), row("parent"), row("other"),
    ]

    private static func nestsThreadsUnderTheirParent() {
        let rows = ConversationNesting.nest(tree)
        precondition(rows.map(\.id) == ["parent", "child-b", "child-a", "grandchild", "other"])
        precondition(rows.map(\.trail) == [[], [true], [false], [false, false], []])
        precondition(rows.map(\.threads) == [3, 0, 1, 0, 0])
    }

    private static func foldingHidesTheSubtree() {
        let rows = ConversationNesting.nest(tree, folded: ["parent"])
        precondition(rows.map(\.id) == ["parent", "other"])
        precondition(rows[0].hasChildren)
        precondition(rows[0].hidden.map(\.sessionId) == ["child-b", "child-a", "grandchild"])
    }

    private static func anUnlistedOrPinnedParentLeavesTheRowTopLevel() {
        precondition(ConversationNesting.nest([row("thread", parent: "gone")]).map(\.depth) == [0])
        let pinned = ConversationNesting.nest([row("pinned", parent: "parent"), row("parent")], pinned: ["pinned"])
        precondition(pinned.map(\.id) == ["pinned", "parent"] && pinned.allSatisfy { $0.depth == 0 })
        let bothPinned = ConversationNesting.nest(
            [row("pinned", parent: "parent"), row("parent")], pinned: ["pinned", "parent"]
        )
        precondition(bothPinned.map(\.id) == ["parent", "pinned"] && bothPinned.map(\.depth) == [0, 1])
        let pinnedParent = ConversationNesting.nest([row("thread", parent: "parent"), row("parent")], pinned: ["parent"])
        precondition(pinnedParent.map(\.id) == ["parent", "thread"] && pinnedParent.map(\.depth) == [0, 1])
    }

    /// Returning from a chat refreshes the list by merge, not by reload: page
    /// one updates in place, older and pinned rows stay where they were, and
    /// a chat removed from the list (archived from its menu) stays out.
    private static func aRefreshKeepsLaterRowsInPlace() {
        let listed = [row("new"), row("recent"), row("old-pinned"), row("older", parent: "recent")]
        let refreshed = listed.refreshed(firstPage: [row("recent"), row("new")])
        precondition(refreshed.map(\.sessionId) == ["recent", "new", "old-pinned", "older"])
        let archived = refreshed.filter { $0.sessionId != "old-pinned" }
        precondition(archived.refreshed(firstPage: [row("recent"), row("new")]).map(\.sessionId) == ["recent", "new", "older"])
    }
}
