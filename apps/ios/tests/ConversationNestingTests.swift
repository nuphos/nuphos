import Foundation

enum ConversationNestingTests {
    static func run() {
        nestsThreadsUnderTheirParent()
        foldingHidesTheSubtree()
        anUnlistedParentLeavesTheRowTopLevel()
        aThreadNestsUnderAParentFromALaterPage()
        aBotIsNeverAThread()
        tasksOrderFamiliesByTheirNewestActivity()
        tasksGroupUnderTheirProjects()
        aBotOwnsWhatItDispatchedAtAnyDepth()
        chatsAndTasksFallBackToTheirOwnNames()
        print("Conversation nesting passed")
    }

    private static func row(_ id: String, parent: String? = nil, active: TimeInterval = 0) -> AgentConversation {
        AgentConversation(
            sessionId: id, title: id, messageCount: 1, createdAt: .now,
            lastActiveAt: Date(timeIntervalSince1970: active), parentSessionId: parent
        )
    }

    private static func bot(_ id: String, parent: String? = nil) -> AgentConversation {
        var bot = row(id, parent: parent)
        bot.avatar = "05-rembrandt"
        return bot
    }

    private static func chat(_ id: String, with botId: String) -> AgentConversation {
        var chat = row(id)
        chat.kind = "channel"
        chat.faces = [ChatFace(id: botId, name: botId, avatarURL: nil, agent: .init(avatar: "05-rembrandt", provider: nil))]
        return chat
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

    private static func anUnlistedParentLeavesTheRowTopLevel() {
        precondition(ConversationNesting.nest([row("thread", parent: "gone")]).map(\.depth) == [0])
        let listed = ConversationNesting.nest([row("thread", parent: "parent"), row("parent")])
        precondition(listed.map(\.id) == ["parent", "thread"] && listed.map(\.depth) == [0, 1])
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

    /// A Bot opened by another agent is still a Bot of its own (#2500); its threads stay under it.
    private static func aBotIsNeverAThread() {
        let rows = ConversationNesting.nest([row("task"), bot("nested", parent: "task"), row("job", parent: "nested")])
        precondition(rows.map(\.id) == ["task", "nested", "job"] && rows.map(\.depth) == [0, 0, 1])
    }

    /// A thread's activity lifts its whole family, and a family with an open question leads.
    private static func tasksOrderFamiliesByTheirNewestActivity() {
        var asking = row("asking", active: 1)
        asking.inputRequests = [.init(id: "q", category: nil, question: "Ship?", options: nil, askedAt: nil)]
        let rows = [row("recent", active: 30), row("old", active: 10), row("busy", parent: "old", active: 40), asking]
        precondition(ConversationNesting.nest(rows).map(\.id) == ["recent", "old", "busy", "asking"])
        let waiting = ConversationNesting.nest(rows, attention: \.isWaiting)
        precondition(waiting.map(\.id) == ["asking", "old", "busy", "recent"])
        // Families that need the viewer come first, and a line sets them apart.
        precondition(waiting.filter(\.divider).map(\.id) == ["old"])
        let unread = ConversationNesting.nest(rows, attention: { $0.isWaiting || $0.sessionId == "recent" })
        precondition(unread.map(\.id) == ["asking", "recent", "old", "busy"])
        precondition(unread.filter(\.divider).map(\.id) == ["old"])
        // With nothing to ask, there is no line.
        precondition(ConversationNesting.nest(rows, attention: { _ in false }).allSatisfy { !$0.divider })
    }

    /// Desktop's projects: a row per folder in list order, then No project; threads stay under their parent.
    private static func tasksGroupUnderTheirProjects() {
        func task(_ id: String, _ path: String?, parent: String? = nil, active: TimeInterval) -> AgentConversation {
            var task = row(id, parent: parent, active: active)
            task.workspace = path.map { .init(path: $0) }
            return task
        }
        let rows = [task("site", "/work/site", active: 30), task("loose", nil, active: 20),
                    task("fix", "/work/site", parent: "site", active: 10), task("api", "/work/api", active: 40)]
        let grouped = ConversationNesting.withProjects(rows)
        precondition(grouped.filter(\.isProject).map(\.title) == ["site", "api", "No project"])
        let nested = ConversationNesting.nest(grouped, attention: { _ in false })
        precondition(nested.map(\.id) == ["project:/work/api", "api", "project:/work/site", "site", "fix", "project:none", "loose"])
        precondition(nested.map(\.depth) == [0, 1, 0, 1, 2, 0, 1])
        // No folder anywhere: Tasks stays as it was.
        precondition(ConversationNesting.withProjects([row("a"), row("b")]).map(\.id) == ["a", "b"])
        precondition(ConversationNesting.projectName("C:\\work\\site") == "site")
    }

    /// The nearest Bot up a row's parents owns it; Bots and plain Tasks are owned by none.
    private static func aBotOwnsWhatItDispatchedAtAnyDepth() {
        let rows = [bot("lead"), row("job", parent: "lead"), row("step", parent: "job"),
                    bot("helper", parent: "job"), row("fix", parent: "helper"), row("task"), row("loop", parent: "loop")]
        let owners = ConversationNesting.botOwners(rows)
        precondition(owners == ["job": "lead", "step": "lead", "fix": "helper"])
    }

    private static func chatsAndTasksFallBackToTheirOwnNames() {
        var untitled = AgentConversation(sessionId: "c", title: "", messageCount: 0, createdAt: .now, lastActiveAt: .now)
        precondition(untitled.displayTitle == "Untitled task")
        untitled.kind = "channel"
        precondition(untitled.displayTitle == "New Group Chat")
    }
}
