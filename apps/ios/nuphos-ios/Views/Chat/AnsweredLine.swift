import MarkdownView
import SwiftUI
import UIKit

/// "✓ Sam answered  Which region?  [ us-east ]  ⌄": a question someone answered,
/// on one line. Opened, it shows the question as it was asked under the line:
/// its body, every option with the picked ones filled, and when.
struct AnsweredLine: View {
    let question: AnsweredQuestion
    var onLink: ((URL) -> Void)?
    @State private var expanded = false
    @Environment(\.transcriptReadingInteraction) private var readingInteraction

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                disclose(readingInteraction) { expanded.toggle() }
            } label: {
                // One line when it all fits; a narrow screen gives the question and its answer a line of their own.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { who; asked; answer; chevron }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 8) { who; chevron }
                        HStack(spacing: 8) { asked; answer }
                    }
                    .padding(.vertical, 6)
                }
                .font(Theme.Text.label)
                .lineLimit(1)
                .padding(.horizontal, 6)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(question.name) answered \(question.question): \(question.answer)")
            .accessibilityHint(expanded ? "Collapses the question" : "Shows the question")
            .accessibilityIdentifier("answered.line")
            if let waiting = question.waiting {
                Text(waiting)
                    .font(Theme.Text.caption)
                    .foregroundStyle(Theme.warning)
                    .padding(.horizontal, 6)
            }
            if expanded { card }
        }
    }

    @ViewBuilder private var who: some View {
        Image(systemName: "checkmark")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Theme.body)
        Text("\(question.name) answered")
            .fontWeight(.semibold)
            .foregroundStyle(Theme.heading)
            .fixedSize()
    }

    private var asked: some View {
        Text(question.question).foregroundStyle(Theme.body)
    }

    private var answer: some View {
        Text(question.answer)
            .fontWeight(.semibold)
            .foregroundStyle(Theme.heading)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .frame(maxWidth: 180)
            .fixedSize(horizontal: true, vertical: false)
            .background(Theme.chatSurface, in: Capsule())
            .layoutPriority(1)
    }

    private var chevron: some View {
        Image(systemName: expanded ? "chevron.up" : "chevron.down")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.body)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(question.question)
                .font(.headline)
                .foregroundStyle(Theme.heading)
            if let body = question.body {
                AssistantMarkdown(text: body, theme: Self.bodyTheme, onLink: onLink)
            }
            let picked = question.picked
            ForEach(question.options, id: \.self) { option in
                let chosen = picked.contains(option)
                HStack(spacing: 6) {
                    if chosen { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)) }
                    Text(option).fontWeight(.medium)
                }
                .font(Theme.Text.secondary)
                .foregroundStyle(chosen ? Theme.chatCanvas : Theme.heading.opacity(0.45))
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(chosen ? Theme.heading : Theme.bubble, in: Capsule())
                .accessibilityAddTraits(chosen ? .isSelected : [])
            }
            if picked.isEmpty {
                Text(question.answer)
                    .font(Theme.Text.secondary)
                    .foregroundStyle(Theme.heading)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.heading.opacity(0.05), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
            Text(times)
                .font(Theme.Text.caption)
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityIdentifier("answered.card")
    }

    /// The body reads under the question, in the secondary color.
    private static var bodyTheme: MarkdownTheme {
        var theme = AssistantMarkdown.bubbleTheme
        theme.colors.body = UIColor(Theme.body)
        theme.fonts.body = Theme.Text.uiFont(.subheadline)
        theme.fonts.bold = Theme.Text.uiFont(.subheadline, weight: .semibold)
        return theme
    }

    private var times: String {
        let answered = question.answered.map { ChatTime.label(for: $0) } ?? ""
        if let asked = question.asked {
            return String(localized: "Asked \(ChatTime.label(for: asked)) · Answered \(answered) from the Inbox",
                          comment: "Answered question: when it was asked and answered")
        }
        return String(localized: "Answered \(answered) from the Inbox", comment: "Answered question: when it was answered")
    }
}
