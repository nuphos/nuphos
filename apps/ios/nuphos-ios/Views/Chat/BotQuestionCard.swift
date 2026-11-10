import SwiftUI

/// An open question, in a Bot's chat or the Inbox, like the desktop's decision
/// card: which agent asked, the question, each option as the reply, and a short
/// typed answer. A connect or secure-input question is answered in the
/// conversation that asked, which the link opens.
struct BotQuestionCard: View {
    let question: BotQuestion
    let onOpen: () -> Void
    let onAnswer: (String) -> Void

    @State private var draft = ""

    /// The desktop's `cardReplies`: one per option, or "Done." for a to-do; nil
    /// when only the conversation can answer it.
    private var replies: [(label: String, reply: String)]? {
        if ["credential", "integration"].contains(question.request.category) { return nil }
        let options = (question.request.options ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        if options.isEmpty { return [(String(localized: "Mark as done"), "Done.")] }
        return options.map { ($0, $0) }
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
                if let replies {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(replies, id: \.reply) { reply in
                            Button(reply.label) { onAnswer(reply.reply) }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .tint(Theme.heading)
                        }
                    }
                    HStack(spacing: 8) {
                        TextField("Or type a different answer", text: $draft)
                            .font(Theme.Text.label)
                            .textFieldStyle(.roundedBorder)
                            .submitLabel(.send)
                            .onSubmit(send)
                            .accessibilityLabel("Reply to this question")
                        Button("Send", action: send)
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .tint(Theme.heading)
                            .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                } else {
                    Button("Answer in the conversation", action: onOpen)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(Theme.heading)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .accessibilityIdentifier("botQuestion.card")
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        onAnswer(text)
    }
}
