import SwiftUI

/// A question in a Bot's chat, like the desktop's decision card: which agent
/// asked, the question, and each option as the reply. A question with no
/// options is answered in the conversation that asked, which the link opens.
struct BotQuestionCard: View {
    let question: BotQuestion
    let onOpen: () -> Void
    let onAnswer: (String) -> Void

    private var options: [String] {
        (question.request.options ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private var heading: LocalizedStringKey {
        switch question.request.category {
        case "approval": "Approval needed"
        case "preference": "Your choice"
        case "credential": "Credential needed"
        case "integration": "Integration needed"
        case "risk_tradeoff": "Weigh the tradeoff"
        default: "Decision needed"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onOpen) {
                HStack(spacing: 3) {
                    Text("From \(question.title)").lineLimit(1)
                    Image(systemName: "arrow.up.right")
                }
                .font(Theme.Text.caption)
                .foregroundStyle(Theme.muted)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("botQuestion.from")
            VStack(alignment: .leading, spacing: 10) {
                Text(heading).font(Theme.Text.secondary.weight(.medium)).foregroundStyle(Theme.heading)
                Text(question.request.question).font(Theme.Text.label).foregroundStyle(Theme.body)
                if options.isEmpty {
                    Text("Open the conversation to answer.").font(Theme.Text.caption).foregroundStyle(Theme.muted)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(options, id: \.self) { option in
                            Button(option) { onAnswer(option) }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .tint(Theme.heading)
                        }
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .accessibilityIdentifier("botQuestion.card")
    }
}
