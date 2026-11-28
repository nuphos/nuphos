import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The Live Activity's Lock Screen card: every running conversation, the
/// newest first. A row opens its conversation; the widget links the rest of
/// the card to the conversation list.
struct TurnCard: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                TurnCardMark(size: 16, icon: card.icon)
                Text("Nuphos").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                TurnCardStatus(card: card).font(.subheadline.weight(.medium))
            }
            TurnCardRows(card: card)
        }
        .foregroundStyle(.white)
        .padding(16)
        // The card is always black, so its grays are the dark ones.
        .environment(\.colorScheme, .dark)
    }
}

struct TurnCardRows: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(card.sessions) { session in
                Link(destination: SessionLink.url(teamId: session.teamId, sessionId: session.id) ?? SessionLink.conversations) {
                    HStack(spacing: 8) {
                        TurnPhaseIcon(phase: session.phase)
                        Text(session.title.isEmpty ? String(localized: "Untitled") : session.title).font(.headline).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(session.phase.title)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(session.phase.tint)
                    }
                }
            }
            if card.more > 0 {
                Text("+\(card.more) more").font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

/// The app icon the person picked, cut to a circle, or the Nuphos mark
/// when the card does not name one this build has.
struct TurnCardMark: View {
    let size: CGFloat
    let icon: String?

    var body: some View {
        if let asset = Self.asset(icon) {
            Image(asset).resizable().scaledToFit().clipShape(Circle()).frame(width: size, height: size)
        } else {
            Image("NuphosMark").resizable().scaledToFit().frame(width: size, height: size)
        }
    }

    /// The widget's copy of the icon; nil for an icon from a newer app.
    static func asset(_ icon: String?) -> String? {
        guard let icon else { return nil }
        let name = "LiveActivityIcon-\(icon)"
        #if canImport(UIKit)
        return UIImage(named: name) == nil ? nil : name
        #else
        return name
        #endif
    }
}

/// "2 running", or a check once every row finished.
struct TurnCardStatus: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        if card.active > 0 {
            Text("\(card.active) running").foregroundStyle(.secondary)
        } else if card.finished {
            TurnPhaseIcon(phase: .done)
        }
    }
}

/// The running count alone, for the Dynamic Island.
struct TurnCardCount: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        if card.active > 0 {
            Text("\(card.active)").font(.caption.monospacedDigit().weight(.semibold))
        } else if card.finished {
            TurnPhaseIcon(phase: .done)
        }
    }
}

struct TurnPhaseIcon: View {
    let phase: TurnActivityAttributes.Phase

    var body: some View {
        Image(systemName: phase.symbol).foregroundStyle(phase.tint)
    }
}

extension TurnActivityAttributes.Phase {
    var title: LocalizedStringKey {
        switch self {
        case .running: "Running"
        case .approval: "Needs approval"
        case .done: "Done"
        case .stopped: "Stopped"
        case .unavailable: "Unavailable"
        }
    }

    var symbol: String {
        switch self {
        case .running: "circle.dotted"
        case .approval: "hand.raised.fill"
        case .done: "checkmark.circle.fill"
        case .stopped: "stop.circle.fill"
        case .unavailable: "wifi.slash"
        }
    }

    var tint: Color {
        switch self {
        case .running: .secondary
        case .approval: .orange
        case .done: .green
        case .stopped: .secondary
        case .unavailable: .secondary
        }
    }
}
