import SwiftUI

@main
enum HomeColumnsTests {
    static func main() {
        let columns = NavigationSplitViewVisibility.home(desktopOpen: false)
        precondition(columns.wrappedValue == .all)
        // Compact and back to regular: collapsing writes .detailOnly, which must not stick.
        columns.wrappedValue = .detailOnly
        precondition(columns.wrappedValue == .all)
        // Only an open desktop puts the list away, and closing it brings the list back.
        precondition(NavigationSplitViewVisibility.home(desktopOpen: true).wrappedValue == .detailOnly)
        precondition(NavigationSplitViewVisibility.homeDefault(desktopOpen: false, usesDrawer: false) == .all)
        precondition(NavigationSplitViewVisibility.homeDefault(desktopOpen: false, usesDrawer: true) == .detailOnly)
        precondition(NavigationSplitViewVisibility.homeDefault(desktopOpen: true, usesDrawer: false) == .detailOnly)

        var visibility = NavigationSplitViewVisibility.all
        let stored = Binding(get: { visibility }, set: { visibility = $0 })
        let wide = NavigationSplitViewVisibility.homeSidebar(stored, allowsToggle: true)
        wide.wrappedValue = .detailOnly
        precondition(visibility == .detailOnly)
        wide.wrappedValue = .all
        precondition(visibility == .all)

        let fixed = NavigationSplitViewVisibility.homeSidebar(stored, allowsToggle: false)
        fixed.wrappedValue = .detailOnly
        precondition(visibility == .all)
        let folded = HomeSidebarLayout(isPhone: true, isRegularWidth: false, isPortrait: true, hasVerticalBar: false)
        let regularPhone = HomeSidebarLayout(isPhone: true, isRegularWidth: false, isPortrait: true, hasVerticalBar: false)
        let iPad = HomeSidebarLayout(isPhone: false, isRegularWidth: true, isPortrait: true, hasVerticalBar: false)
        let portrait = HomeSidebarLayout(isPhone: true, isRegularWidth: true, isPortrait: true, hasVerticalBar: false)
        let landscape = HomeSidebarLayout(isPhone: true, isRegularWidth: true, isPortrait: false, hasVerticalBar: true)
        precondition(folded == .standard && regularPhone == .standard && iPad == .standard)
        precondition(portrait == .duoPortrait && landscape == .duoLandscape)

        // Rotation re-applies the default for the destination while a chat stays open.
        precondition(portrait.initialVisibility(hasConversation: true, desktopOpen: false) == .detailOnly)
        precondition(landscape.initialVisibility(hasConversation: true, desktopOpen: false) == .all)
        // A workspace switch applies the same reset with or without a selected chat.
        precondition(portrait.initialVisibility(hasConversation: false, desktopOpen: false) == .all)
        precondition(portrait.initialVisibility(hasConversation: true, desktopOpen: false) == .detailOnly)
        precondition(landscape.initialVisibility(hasConversation: true, desktopOpen: true) == .detailOnly)
        print("Home columns passed")
    }
}
