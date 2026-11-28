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
    static let noProject = projectPrefix + "none"

    /// A row is top-level when its parent is not listed, and a Bot always is (#2500).
    /// Rows under a folded parent are left out. With `attention`, the top-level rows
    /// are ordered as Desktop's Tasks: a family with an open question first, then by
    /// the newest activity anywhere in it, and the families that need the viewer
    /// before a divider and the rest.
    static func nest(
        _ rows: [AgentConversation], folded: Set<String> = [], attention: ((AgentConversation) -> Bool)? = nil
    ) -> [NestedConversation] {
        let listed = Set(rows.map(\.sessionId))
        let parent: (AgentConversation) -> String? = { row in
            row.isBot ? nil : row.parentSessionId.flatMap { listed.contains($0) ? $0 : nil }
        }
        var children: [String: [AgentConversation]] = [:]
        for row in rows { if let id = parent(row) { children[id, default: []].append(row) } }
        func below(_ id: String) -> [AgentConversation] {
            (children[id] ?? []).flatMap { [$0] + below($0.sessionId) }
        }
        var roots = rows.filter { parent($0) == nil }
        var divider: String?
        if let attention {
            let families = roots.enumerated().map { offset, root in
                let all = [root] + below(root.sessionId)
                return (root: root, offset: offset, waiting: all.contains(where: \.isWaiting),
                        asks: all.contains(where: attention), latest: all.map(\.lastActiveAt).max() ?? root.lastActiveAt)
            }.sorted { a, b in
                if a.waiting != b.waiting { return a.waiting }
                return a.latest != b.latest ? a.latest > b.latest : a.offset < b.offset
            }
            let asking = families.filter(\.asks), rest = families.filter { !$0.asks }
            roots = (asking + rest).map(\.root)
            if !asking.isEmpty { divider = rest.first?.root.sessionId }
        }
        var nested: [NestedConversation] = []
        func visit(_ row: AgentConversation, _ trail: [Bool]) {
            let kids = children[row.sessionId] ?? []
            let all = below(row.sessionId)
            let isFolded = !kids.isEmpty && folded.contains(row.sessionId)
            nested.append(.init(conversation: row, trail: trail, threads: all.count, hidden: isFolded ? all : [], divider: row.sessionId == divider))
            if isFolded { return }
            for (index, kid) in kids.enumerated() { visit(kid, trail + [index < kids.count - 1]) }
        }
        for row in roots { visit(row, []) }
        return nested
    }

    /// Desktop's `withProjects`: with any Task in a folder, one row per folder, in
    /// list order, then No project for the rest. A thread stays under its parent;
    /// every other Task goes under its project.
    static func withProjects(_ tasks: [AgentConversation]) -> [AgentConversation] {
        var paths: [String] = []
        for path in tasks.compactMap(\.workspace?.path) where !paths.contains(path) { paths.append(path) }
        guard !paths.isEmpty else { return tasks }
        let listed = Set(tasks.map(\.sessionId))
        let nested = tasks.map { task -> AgentConversation in
            if let parent = task.parentSessionId, listed.contains(parent) { return task }
            var task = task
            task.parentSessionId = task.workspace?.path.map { projectPrefix + $0 } ?? noProject
            return task
        }
        let row = { (id: String, name: String) in
            AgentConversation(sessionId: id, title: name, messageCount: 0, createdAt: .distantPast, lastActiveAt: .distantPast)
        }
        let loose = nested.contains { $0.parentSessionId == noProject }
        return paths.map { row(projectPrefix + $0, projectName($0)) }
            + (loose ? [row(noProject, String(localized: "No project"))] : []) + nested
    }

    /// A folder's last component, as Desktop names a project.
    static func projectName(_ path: String) -> String {
        path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
    }

    /// The Bot each row works for: the nearest Bot up its parents (Desktop's
    /// `botOwner`, #2341). A Bot works for none. Such rows leave Tasks and
    /// open from their Bot's page.
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
}
