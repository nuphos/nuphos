import SwiftUI

/// The top-level pages the home switcher moves between. Order is the
/// switcher's order; `.agent` is where the app opens.
enum HomePage: String, CaseIterable, Identifiable {
    case agent, monitoring, triggers, plans, connectors

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .agent: "Agents"
        case .monitoring: "Monitoring"
        case .triggers: "Triggers"
        case .plans: "Plans"
        case .connectors: "Connectors"
        }
    }

    var systemImage: String {
        switch self {
        case .agent: "sparkles"
        case .monitoring: "waveform.path.ecg"
        case .triggers: "bolt"
        case .plans: "list.bullet.clipboard"
        case .connectors: "app.connected.to.app.below.fill"
        }
    }
}
