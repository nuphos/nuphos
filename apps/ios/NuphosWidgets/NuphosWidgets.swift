import ActivityKit
import SwiftUI
import WidgetKit

@main
struct NuphosWidgets: WidgetBundle {
    var body: some Widget {
        TurnActivityWidget()
    }
}

struct TurnActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TurnActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(.black)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.attributes.url)
        } dynamicIsland: { context in
            let attributes = context.attributes
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    AgentMark(logo: attributes.logo, size: 22).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    PhaseLabel(phase: state.phase)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(attributes.title).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        RuntimeLabel(runtime: attributes.runtime)
                        Spacer()
                        Elapsed(attributes: attributes, state: state)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            } compactLeading: {
                AgentMark(logo: attributes.logo, size: 18)
            } compactTrailing: {
                if state.phase == .running {
                    Elapsed(attributes: attributes, state: state)
                        .font(.caption.monospacedDigit())
                        .frame(maxWidth: 48)
                } else {
                    PhaseIcon(phase: state.phase)
                }
            } minimal: {
                PhaseIcon(phase: state.phase)
            }
            .widgetURL(attributes.url)
        }
    }
}

private struct LockScreenView: View {
    let attributes: TurnActivityAttributes
    let state: TurnActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image("NuphosMark").resizable().scaledToFit().frame(width: 16, height: 16)
                Text("Nuphos").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            }
            HStack(spacing: 8) {
                AgentMark(logo: attributes.logo, size: 18)
                Text(attributes.title).font(.headline).lineLimit(1)
                Spacer(minLength: 8)
                PhaseLabel(phase: state.phase)
            }
            HStack {
                RuntimeLabel(runtime: attributes.runtime)
                Spacer(minLength: 8)
                Elapsed(attributes: attributes, state: state)
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .foregroundStyle(.white)
        .padding(16)
    }
}

private struct AgentMark: View {
    let logo: String
    let size: CGFloat

    var body: some View {
        Image(logo).resizable().scaledToFit().frame(width: size, height: size)
    }
}

private struct RuntimeLabel: View {
    let runtime: String?

    var body: some View {
        if let runtime {
            Label(runtime, systemImage: "laptopcomputer").lineLimit(1)
        }
    }
}

/// Counts up while the turn runs; the turn's length once it ends.
private struct Elapsed: View {
    let attributes: TurnActivityAttributes
    let state: TurnActivityAttributes.ContentState

    var body: some View {
        if let endedAt = state.endedAt {
            let seconds = max(0, endedAt - attributes.startedAt.timeIntervalSince1970)
            Text(Duration.seconds(seconds).formatted(.time(pattern: seconds < 3600 ? .minuteSecond : .hourMinuteSecond)))
                .monospacedDigit()
        } else {
            Text(attributes.startedAt, style: .timer).monospacedDigit().multilineTextAlignment(.trailing)
        }
    }
}

private struct PhaseLabel: View {
    let phase: TurnActivityAttributes.Phase

    var body: some View {
        HStack(spacing: 4) {
            PhaseIcon(phase: phase)
            Text(phase.title)
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(phase.tint)
    }
}

private struct PhaseIcon: View {
    let phase: TurnActivityAttributes.Phase

    var body: some View {
        Image(systemName: phase.symbol).foregroundStyle(phase.tint)
    }
}

private extension TurnActivityAttributes.Phase {
    var title: LocalizedStringKey {
        switch self {
        case .running: "Running"
        case .approval: "Needs approval"
        case .done: "Done"
        case .failed: "Failed"
        case .stopped: "Stopped"
        }
    }

    var symbol: String {
        switch self {
        case .running: "circle.dotted"
        case .approval: "hand.raised.fill"
        case .done: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        case .stopped: "stop.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .running: .secondary
        case .approval: .orange
        case .done: .green
        case .failed: .red
        case .stopped: .secondary
        }
    }
}
