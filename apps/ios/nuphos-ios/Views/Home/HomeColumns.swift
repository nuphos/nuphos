import SwiftUI

extension NavigationSplitViewVisibility {
    /// The home split view's columns where the window is wide: the list beside the detail, put
    /// away only while a desktop shows beside the conversation.
    ///
    /// Derived, never stored, and the split view's own writes are dropped. It writes `.detailOnly`
    /// when it collapses, as it does while the app is in the background on the unfolded iPhone Duo
    /// (iOS lays the app out at the cover display's compact width for its snapshot), and when it
    /// puts an overlaid list away. A stored value kept that once the window was wide again (#1680).
    static func home(desktopOpen: Bool) -> Binding<NavigationSplitViewVisibility> {
        Binding(get: { homeDefault(desktopOpen: desktopOpen, usesDrawer: false) }, set: { _ in })
    }

    static func homeDefault(desktopOpen: Bool, usesDrawer: Bool) -> Self {
        desktopOpen || usesDrawer ? .detailOnly : .all
    }

    static func homeSidebar(_ visibility: Binding<Self>, allowsToggle: Bool) -> Binding<Self> {
        Binding(get: { visibility.wrappedValue }, set: { value in
            if allowsToggle { visibility.wrappedValue = value }
        })
    }
}


// The cover display and other devices keep their existing navigation.
enum HomeSidebarLayout: Equatable {
    case standard
    case duoLandscape
    case duoPortrait

    init(isPhone: Bool, isRegularWidth: Bool, isPortrait: Bool, hasVerticalBar: Bool) {
        guard isPhone, isRegularWidth else {
            self = .standard
            return
        }
        if isPortrait {
            self = .duoPortrait
        } else {
            self = hasVerticalBar ? .duoLandscape : .standard
        }
    }

    func usesDrawer(hasConversation: Bool, desktopOpen: Bool) -> Bool {
        self == .duoPortrait && hasConversation && !desktopOpen
    }

    func initialVisibility(hasConversation: Bool, desktopOpen: Bool) -> NavigationSplitViewVisibility {
        .homeDefault(desktopOpen: desktopOpen,
                     usesDrawer: usesDrawer(hasConversation: hasConversation, desktopOpen: desktopOpen))
    }
}
