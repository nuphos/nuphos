import SwiftUI

/// The top-level pages the home switcher moves between. Order is the
/// switcher's order. The app opens on `.chats` when the viewer has a chat,
/// else on `.agent`; the two are tabs of one list (`AgentPage`).
enum HomePage: String, CaseIterable, Identifiable {
    case chats, agent, inbox, plans, runtimes, connectors

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .chats: "Bots"
        case .agent: "Tasks"
        case .inbox: "Inbox"
        case .plans: "Plans"
        case .runtimes: "Runtimes"
        case .connectors: "Connectors"
        }
    }

    var systemImage: String {
        switch self {
        case .chats: "bubble.left.and.bubble.right"
        case .agent: "sparkles"
        case .inbox: "tray"
        case .plans: "list.bullet.clipboard"
        case .runtimes: "cpu"
        case .connectors: "app.connected.to.app.below.fill"
        }
    }
}

extension HomePage {
    /// Chats and Agents: the two tabs of the home list.
    var isHomeList: Bool { self == .chats || self == .agent }

    private static let hasChatsKey = "nuphos.home.hasChats"

    /// Whether the viewer had a chat when the list last loaded, so the app
    /// opens on the tab it will keep.
    static var hasChats: Bool {
        get { UserDefaults.standard.bool(forKey: hasChatsKey) }
        set { UserDefaults.standard.set(newValue, forKey: hasChatsKey) }
    }
}
