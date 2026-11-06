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
        print("Home columns passed")
    }
}
