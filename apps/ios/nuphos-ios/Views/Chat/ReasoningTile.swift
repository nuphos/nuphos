import SwiftUI

/// Thinking as one compact disclosure line, the desktop's thinking fold:
/// "Thought for 12s" and the summary's title; the full summary beside a
/// rule once opened.
struct ReasoningTile: View {
    let part: ChatPart.ReasoningPart
    @State private var expanded = ProcessInfo.processInfo.arguments.contains("-expand-all")
    @Environment(\.transcriptReadingInteraction) private var readingInteraction

    private var isThinking: Bool { part.state == .streaming }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                disclose(readingInteraction) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(Theme.Text.micro.weight(.semibold))
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(title(now: context.date))
                            .monospacedDigit()
                            .shimmer(active: isThinking)
                    }
                    .fixedSize()
                    if let headline = ReasoningText.headline(part.text) {
                        Text(headline)
                            .lineLimit(1)
                            .foregroundStyle(Theme.muted.opacity(0.8))
                    }
                    Image(systemName: "chevron.right")
                        .font(Theme.Text.micro.weight(.bold))
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                        .opacity(expanded ? 0.6 : 0.35)
                    Spacer(minLength: 0)
                }
                .font(Theme.Text.label)
                .foregroundStyle(Theme.muted)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if expanded {
                Text(ReasoningText.attributed(part.text))
                    .font(Theme.Text.secondary)
                    .lineSpacing(Theme.Text.leading)
                    .foregroundStyle(Theme.body)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) {
                        Rectangle().fill(Theme.hairline).frame(width: 2).padding(.leading, 3)
                    }
                    .padding(.top, 6)
            }
        }
    }

    private func title(now: Date) -> String {
        let seconds = part.startedAt.map { Int((part.endedAt ?? now).timeIntervalSince($0)) } ?? 0
        if isThinking { return seconds > 0 ? "Thinking \(seconds)s" : "Thinking" }
        return seconds > 0 ? "Thought for \(seconds)s" : "Thought"
    }
}

/// Three bouncing dots.
struct ThreeDots: View {
    var size: CGFloat = 4
    var color: Color = Theme.body

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: size * 0.8) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(color)
                        .frame(width: size, height: size)
                        .offset(y: -abs(sin((t * 3) + Double(i) * 0.6)) * size * 1.2)
                }
            }
            .frame(height: size * 3, alignment: .bottom)
        }
        .accessibilityHidden(true)
    }
}
