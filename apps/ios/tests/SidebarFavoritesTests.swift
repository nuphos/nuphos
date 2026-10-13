import Foundation

enum SidebarFavoritesTests {
    static func run() {
        readsAKeyPin()
        readsADesktopHrefPin()
        ignoresOtherPages()
        print("Sidebar favorites passed")
    }

    private static func entry(key: String? = nil, href: String? = nil) -> SidebarFavorites.Entry {
        SidebarFavorites.Entry(label: "Chat", key: key, href: href)
    }

    private static func readsAKeyPin() {
        precondition(entry(key: "agent-session:ses_abc").sessionId == "ses_abc")
        precondition(entry(key: "agent-session:").sessionId == nil)
    }

    private static func readsADesktopHrefPin() {
        // Desktop pins a chat row by its page path, not by key.
        precondition(entry(href: "/teams/team-1/agent/ses_abc").sessionId == "ses_abc")
        precondition(entry(href: "/teams/team-1/agent/ses_abc?x=1").sessionId == "ses_abc")
        precondition(entry(href: "/teams/team-1/agent/a%20b").sessionId == "a b")
        let favorites = SidebarFavorites(entries: [entry(href: "/teams/team-1/agent/ses_abc")], revision: 1)
        precondition(favorites.pinnedSessionIds == ["ses_abc"])
    }

    private static func ignoresOtherPages() {
        precondition(entry(href: "/teams/team-1/agent").sessionId == nil)
        precondition(entry(href: "/teams/team-1/triggers").sessionId == nil)
        precondition(entry(href: "/teams/team-1/agent/ses_abc/extra").sessionId == nil)
        precondition(entry(key: "team.triggers").sessionId == nil)
    }
}
