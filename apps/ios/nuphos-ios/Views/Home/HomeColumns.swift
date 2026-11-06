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
        Binding(get: { desktopOpen ? .detailOnly : .all }, set: { _ in })
    }
}
