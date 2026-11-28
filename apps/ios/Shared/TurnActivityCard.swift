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

/// The expanded Dynamic Island: what needs the person first, then at most
/// `rows` conversations as inset capsules, so no text reaches the island's
/// rounded corners.
struct TurnIslandExpanded: View {
    let card: TurnActivityAttributes.ContentState

    static let rows = 2

    var body: some View {
        let shown = card.sessions.prefix(Self.rows)
        let more = card.more + card.sessions.count - shown.count

        VStack(alignment: .leading, spacing: 6) {
            TurnCardHeadline(card: card)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 4)
            ForEach(shown) { session in
                Link(destination: SessionLink.url(teamId: session.teamId, sessionId: session.id) ?? SessionLink.conversations) {
                    HStack(spacing: 8) {
                        TurnPhaseIcon(phase: session.phase).font(.subheadline)
                        Text(session.title.isEmpty ? String(localized: "Untitled") : session.title)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(session.phase.shortTitle)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(session.phase.tint)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.white.opacity(0.1), in: Capsule())
                }
            }
            if more > 0 {
                Text("+\(more) more").font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
            }
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 4)
    }
}

/// "1 needs you · 2 running", "2 running", or "Done".
struct TurnCardHeadline: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        let running = card.active - card.needsYou

        if card.needsYou > 0 && running > 0 {
            HStack(spacing: 0) {
                Text("\(card.needsYou) needs you").foregroundStyle(.orange)
                Text(" · \(running) running").foregroundStyle(.secondary)
            }
        } else if card.needsYou > 0 {
            Text("\(card.needsYou) needs you").foregroundStyle(.orange)
        } else if running > 0 {
            Text("\(running) running")
        } else if card.finished {
            Text("Done").foregroundStyle(.green)
        } else {
            Text("Nuphos").foregroundStyle(.secondary)
        }
    }
}

struct TurnCardMark: View {
    let size: CGFloat

    var body: some View {
        Image("NuphosMark").resizable().scaledToFit().frame(width: size, height: size)
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

/// The running count alone, for the Dynamic Island; orange while a
/// conversation waits for the person, since the island never expands for it.
struct TurnCardCount: View {
    let card: TurnActivityAttributes.ContentState

    var body: some View {
        if card.active > 0 {
            Text("\(card.active)")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(card.needsYou > 0 ? .orange : .primary)
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

    /// Fits the expanded island's capsule.
    var shortTitle: LocalizedStringKey {
        switch self {
        case .approval: "Review"
        case .unavailable: "Offline"
        default: title
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
