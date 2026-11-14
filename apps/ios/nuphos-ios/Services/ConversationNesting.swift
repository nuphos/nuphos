import Foundation

/// One row of the Agent page's thread tree.
struct NestedConversation: Identifiable, Equatable {
    let conversation: AgentConversation
    /// Per level, whether a later sibling at that level still follows this row.
    let trail: [Bool]
    /// Every thread under this row, at any depth.
    let threads: Int
    /// Everything under a folded row, so the row can stand in for it.
    let hidden: [AgentConversation]
    /// Finished threads this row counts in its done group instead of listing.
    var done = 0
    /// The first family that asks nothing of the viewer, after those that do.
    var divider = false

    var hasChildren: Bool { threads > 0 }

    var id: String { conversation.sessionId }
    var depth: Int { trail.count }
}

/// The desktop sidebar's `nestItems`: agent-opened threads follow the
/// conversation that opened them, one level deeper, siblings in list order.
enum ConversationNesting {
    static let projectPrefix = "project:"

    /// A row is top-level when its parent is not listed, and a Bot always is (#2500).
    /// Rows under a folded parent are left out. A `finished` thread with nothing
    /// unfinished below it goes in its parent's done group, listed only while
    /// `<id>:done` is in `folded`; a project's own Tasks never do. With
    /// `attention`, the top-level rows are ordered as Desktop's Tasks: a family
    /// with an open question first, then by its newest activity, and families
    /// that ask for the viewer before a divider and the rest.
    static func nest(
        _ rows: [AgentConversation], folded: Set<String> = [],
        finished: (AgentConversation) -> Bool = { _ in false },
        attention: ((AgentConversation) -> Bool)? = nil
    ) -> [NestedConversation] {
        let listed = Set(rows.map(\.sessionId))
        let parent: (AgentConversation) -> String? = { row in
            row.isBot ? nil : row.parentSessionId.flatMap { listed.contains($0) ? $0 : nil }
        }
        var children: [String: [AgentConversation]] = [:]
        for row in rows { if let id = parent(row) { children[id, default: []].append(row) } }
        func settled(_ row: AgentConversation) -> Bool {
            parent(row)?.hasPrefix(projectPrefix) == false && finished(row)
                && (children[row.sessionId] ?? []).allSatisfy(settled)
        }
        func kids(_ id: String) -> [AgentConversation] {
            let all = children[id] ?? []
            return all.filter { !settled($0) } + (folded.contains(id + ":done") ? all.filter(settled) : [])
        }
        func below(_ id: String) -> [AgentConversation] { kids(id).flatMap { [$0] + below($0.sessionId) } }
        func family(_ id: String) -> [AgentConversation] {
            (children[id] ?? []).flatMap { [$0] + family($0.sessionId) }
        }
        var roots = rows.filter { parent($0) == nil }
        var divider: String?
        if let attention {
            struct Rank { let root: AgentConversation, offset: Int, waiting: Bool, asks: Bool, latest: Date }
            let ranked = roots.enumerated().map { offset, root -> Rank in
                let all = [root] + family(root.sessionId)
                let latest = all.map(\.lastActiveAt).max() ?? root.lastActiveAt
                return Rank(root: root, offset: offset, waiting: all.contains(where: \.isWaiting), asks: all.contains(where: attention), latest: latest)
            }.sorted { (a: Rank, b: Rank) -> Bool in
                if a.waiting != b.waiting { return a.waiting }
                if a.latest != b.latest { return a.latest > b.latest }
                return a.offset < b.offset
            }
            let asking = ranked.filter { $0.asks }, rest = ranked.filter { !$0.asks }
            roots = (asking + rest).map { $0.root }
            if !asking.isEmpty { divider = rest.first?.root.sessionId }
        }
        var nested: [NestedConversation] = []
        func visit(_ row: AgentConversation, _ trail: [Bool]) {
            let id = row.sessionId
            let shown = kids(id)
            let isFolded = !shown.isEmpty && folded.contains(id)
            let all = below(id)
            nested.append(.init(
                conversation: row, trail: trail, threads: all.count, hidden: isFolded ? all : [],
                done: isFolded ? 0 : (children[id] ?? []).filter(settled).count, divider: id == divider
            ))
            if isFolded { return }
            for (index, kid) in shown.enumerated() { visit(kid, trail + [index < shown.count - 1]) }
        }
        for row in roots { visit(row, []) }
        return nested
    }

    /// Desktop's `withProjects`: with any Task in a folder, one row per folder,
    /// in list order, then No project for the rest. A thread stays under its
    /// parent; every other Task goes under its project.
    static func withProjects(_ tasks: [AgentConversation]) -> [AgentConversation] {
        var paths: [String] = []
        for path in tasks.compactMap(\.workspace?.path) where !paths.contains(path) { paths.append(path) }
        guard !paths.isEmpty else { return tasks }
        let listed = Set(tasks.map(\.sessionId))
        let none = projectPrefix + "none"
        let nested = tasks.map { task -> AgentConversation in
            if let parent = task.parentSessionId, listed.contains(parent) { return task }
            var task = task
            task.parentSessionId = task.workspace?.path.map { projectPrefix + $0 } ?? none
            return task
        }
        let row = { (id: String, name: String) in
            AgentConversation(sessionId: id, title: name, messageCount: 0, createdAt: .distantPast, lastActiveAt: .distantPast)
        }
        let loose = nested.contains { $0.parentSessionId == none }
        return paths.map { row(projectPrefix + $0, projectName($0)) } + (loose ? [row(none, "No project")] : []) + nested
    }

    /// A folder's last component, as Desktop names a project.
    static func projectName(_ path: String) -> String {
        path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
    }

    /// The Bot each row works for: the nearest Bot up its parents (Desktop's
    /// `botOwner`, #2341). A Bot works for none. Such rows leave Tasks and
    /// follow their Bot under Bots.
    static func botOwners(_ rows: [AgentConversation]) -> [String: String] {
        let byId = Dictionary(rows.map { ($0.sessionId, $0) }, uniquingKeysWith: { first, _ in first })
        var owners: [String: String] = [:]
        for row in rows where !row.isBot {
            var seen: Set<String> = [row.sessionId]
            var next = row.parentSessionId
            while let id = next, seen.insert(id).inserted, let up = byId[id] {
                if up.isBot { owners[row.sessionId] = id; break }
                next = up.parentSessionId
            }
        }
        return owners
    }

    /// What Bots lists, in `list` order: each chat or Bot, and under a Bot's
    /// 1:1 chat (or the Bot, while it has no chat) what the Bot dispatched,
    /// as Desktop's `botChatRows` does. Only the Bot's direct threads move
    /// under its chat; deeper ones keep their parents.
    /// A pinned chat or Bot leaves the list with everything under it, as
    /// Desktop's `unpinnedChatItems` does.
    static func botRows(
        _ list: [AgentConversation], threads: [AgentConversation], owners: [String: String], pinned: Set<String> = []
    ) -> [AgentConversation] {
        let chats = Dictionary(list.compactMap { row in row.botId.map { ($0, row.sessionId) } }, uniquingKeysWith: { first, _ in first })
        let gone = pinned.union(list.filter { pinned.contains($0.sessionId) }.compactMap(\.botId))
        let moved = threads.filter { owners[$0.sessionId].map { !gone.contains($0) } == true }.map { row -> AgentConversation in
            var row = row
            if let bot = row.parentSessionId, let chat = chats[bot] { row.parentSessionId = chat }
            return row
        }
        return list.filter { !pinned.contains($0.sessionId) } + moved
    }
}
