import Foundation

enum ConversationNestingTests {
    static func run() {
        nestsThreadsUnderTheirParent()
        foldingHidesTheSubtree()
        anUnlistedOrPinnedParentLeavesTheRowTopLevel()
        aRefreshKeepsLaterRowsInPlace()
        aThreadNestsUnderAParentFromALaterPage()
        aRefreshTakesTheServersWatchState()
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

    /// Unwatching A: the server unwatched A, B and C, though B already was.
    /// Reading the list back replaces every stale local flag with its answer.
    private static func aRefreshTakesTheServersWatchState() {
        func watched(_ id: String, parent: String? = nil, _ value: Bool) -> AgentConversation {
            var conversation = row(id, parent: parent)
            conversation.watching = value
            return conversation
        }
        let local = [watched("a", true), watched("b", parent: "a", false), watched("c", parent: "b", true)]
        let server = [watched("a", false), watched("b", parent: "a", false), watched("c", parent: "b", false)]
        precondition(local.refreshed(firstPage: server).map(\.watching) == [false, false, false])
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

    /// Page one holds the thread; its parent is older and on a later page.
    /// The page carries that parent, so the thread nests at once. A parent the
    /// listing hides (archived, or a search miss) is not sent, and the thread
    /// stays listed on its own.
    private static func aThreadNestsUnderAParentFromALaterPage() {
        let first = AgentConversationsPage(
            conversations: [row("thread", parent: "parent"), row("newest")],
            parents: [row("parent"), row("newest")], nextCursor: "c", hasMore: true
        )
        precondition(first.rows.map(\.sessionId) == ["thread", "newest", "parent"])
        let nested = ConversationNesting.nest(first.rows)
        precondition(nested.map(\.id) == ["newest", "parent", "thread"] && nested.map(\.depth) == [0, 0, 1])
        let hidden = AgentConversationsPage(conversations: [row("thread", parent: "archived")], nextCursor: nil, hasMore: false)
        precondition(ConversationNesting.nest(hidden.rows).map(\.depth) == [0])
    }
}
