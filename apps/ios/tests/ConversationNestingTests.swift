import Foundation

enum ConversationNestingTests {
    static func run() {
        nestsThreadsUnderTheirParent()
        foldingHidesTheSubtree()
        anUnlistedOrPinnedParentLeavesTheRowTopLevel()
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
    }
}
