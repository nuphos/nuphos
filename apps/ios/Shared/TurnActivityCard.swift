import SwiftUI

/// The Live Activity's Lock Screen card: every running conversation, the
/// newest first. A row opens its conversation; the widget links the rest of
/// the card to the conversation list.
struct TurnCard: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                TurnCardMark(size: 16)
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
                        Text(session.title.isEmpty ? "Untitled" : session.title).font(.headline).lineLimit(1)
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

struct TurnCardMark: View {
    let size: CGFloat

    var body: some View {
        Image("NuphosMark").resizable().scaledToFit().frame(width: size, height: size)
    }
}

/// "2 running", or a check once nothing runs.
struct TurnCardStatus: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        if card.active > 0 {
            Text("\(card.active) running").foregroundStyle(.secondary)
        } else {
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
        } else {
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
        }
    }

    var symbol: String {
        switch self {
        case .running: "circle.dotted"
        case .approval: "hand.raised.fill"
        case .done: "checkmark.circle.fill"
        case .stopped: "stop.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .running: .secondary
        case .approval: .orange
        case .done: .green
        case .stopped: .secondary
        }
    }
}
