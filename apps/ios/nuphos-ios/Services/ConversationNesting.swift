/// One row of the Agent page's thread tree.
struct NestedConversation: Identifiable, Equatable {
    let conversation: AgentConversation
    /// Per level, whether a later sibling at that level still follows this row.
    let trail: [Bool]
    /// Every thread under this row, at any depth.
    let threads: Int
    /// Everything under a folded row, so the row can stand in for it.
    let hidden: [AgentConversation]

    var hasChildren: Bool { threads > 0 }

    var id: String { conversation.sessionId }
    var depth: Int { trail.count }
}

/// The desktop sidebar's `nestItems`: agent-opened threads follow the
/// conversation that opened them, one level deeper, siblings in list order.
enum ConversationNesting {
    /// A row is top-level when its parent is not listed, and a Bot always is (#2500).
    /// Rows under a folded parent are left out. `byFamily` orders the top-level rows
    /// as Desktop's Tasks does: a family with an open question first, then by the
    /// newest activity anywhere in it.
    static func nest(_ rows: [AgentConversation], folded: Set<String> = [], byFamily: Bool = false) -> [NestedConversation] {
        let listed = Set(rows.map(\.sessionId))
        let parent: (AgentConversation) -> String? = { row in
            row.isBot ? nil : row.parentSessionId.flatMap { listed.contains($0) ? $0 : nil }
        }
        var children: [String: [AgentConversation]] = [:]
        for row in rows { if let id = parent(row) { children[id, default: []].append(row) } }
        func below(_ id: String) -> [AgentConversation] {
            (children[id] ?? []).flatMap { [$0] + below($0.sessionId) }
        }
        var nested: [NestedConversation] = []
        func visit(_ row: AgentConversation, _ trail: [Bool]) {
            let kids = children[row.sessionId] ?? []
            let all = below(row.sessionId)
            let isFolded = !kids.isEmpty && folded.contains(row.sessionId)
            nested.append(.init(conversation: row, trail: trail, threads: all.count, hidden: isFolded ? all : []))
            if isFolded { return }
            for (index, kid) in kids.enumerated() { visit(kid, trail + [index < kids.count - 1]) }
        }
        var roots = rows.filter { parent($0) == nil }
        if byFamily {
            let rank = Dictionary(roots.map { root in
                let family = [root] + below(root.sessionId)
                return (root.sessionId, (family.contains(where: \.isWaiting), family.map(\.lastActiveAt).max() ?? root.lastActiveAt))
            }, uniquingKeysWith: { first, _ in first })
            roots = roots.enumerated().sorted { a, b in
                let (x, y) = (rank[a.element.sessionId]!, rank[b.element.sessionId]!)
                if x.0 != y.0 { return x.0 }
                return x.1 != y.1 ? x.1 > y.1 : a.offset < b.offset
            }.map(\.element)
        }
        for row in roots { visit(row, []) }
        return nested
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
    static func botRows(_ list: [AgentConversation], threads: [AgentConversation], owners: [String: String]) -> [AgentConversation] {
        let chats = Dictionary(list.compactMap { row in row.botId.map { ($0, row.sessionId) } }, uniquingKeysWith: { first, _ in first })
        let moved = threads.filter { owners[$0.sessionId] != nil }.map { row -> AgentConversation in
            var row = row
            if let bot = row.parentSessionId, let chat = chats[bot] { row.parentSessionId = chat }
            return row
        }
        return list + moved
    }
}
