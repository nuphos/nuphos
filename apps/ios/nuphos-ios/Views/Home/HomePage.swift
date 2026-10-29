import SwiftUI

/// The top-level pages the home switcher moves between. Order is the
/// switcher's order; `.agent` is where the app opens.
enum HomePage: String, CaseIterable, Identifiable {
    case agent, plans, runtimes, connectors

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .agent: "Agents"
        case .plans: "Plans"
        case .runtimes: "Runtimes"
        case .connectors: "Connectors"
        }
    }

    var systemImage: String {
        switch self {
        case .agent: "sparkles"
        case .plans: "list.bullet.clipboard"
        case .runtimes: "cpu"
        case .connectors: "app.connected.to.app.below.fill"
        }
    }
}
