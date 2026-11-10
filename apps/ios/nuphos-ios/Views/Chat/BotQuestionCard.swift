import SwiftUI

/// An open question, in a Bot's chat or the Inbox, like the desktop's decision
/// card: which agent asked, the question and what the agent wrote to decide it
/// from, each option as the reply, and a short typed answer. A connect or
/// secure-input question is answered in the conversation that asked, which the
/// link opens. `showsFrom` is off for the Bot's own questions in its own chat.
struct BotQuestionCard: View {
    let question: BotQuestion
    var showsFrom = true
    let onOpen: () -> Void
    let onAnswer: (String) -> Void
    /// A tapped link in the body. Absent, the system opens it.
    var onLink: ((URL) -> Void)?

    @State private var draft = ""
    @State private var expanded = false
    @Environment(\.openURL) private var openURL

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
            if showsFrom {
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
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(heading).font(Theme.Text.secondary.weight(.medium)).foregroundStyle(Theme.heading)
                Text(question.request.question).font(Theme.Text.label).foregroundStyle(Theme.body)
                if let body = question.request.body?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty {
                    questionBody(body)
                }
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

    /// The question's markdown body: a few lines at first, "Show more" for the rest, as on the desktop.
    @ViewBuilder private func questionBody(_ text: String) -> some View {
        let long = Self.isLongBody(text)
        VStack(alignment: .leading, spacing: 4) {
            AssistantMarkdown(text: text, theme: AssistantMarkdown.bubbleTheme, onLink: { onLink?($0) ?? openURL($0) })
                .frame(maxHeight: long && !expanded ? 64 : nil, alignment: .top)
                .clipped()
                .accessibilityIdentifier("botQuestion.body")
            if long {
                Button(expanded ? "Show less" : "Show more") { expanded.toggle() }
                    .font(Theme.Text.caption)
                    .foregroundStyle(Theme.muted)
                    .buttonStyle(.plain)
            }
        }
    }

    /// More than about three lines of text: shown collapsed until asked for.
    static func isLongBody(_ text: String) -> Bool {
        text.split(separator: "\n", omittingEmptySubsequences: false).count > 3 || text.count > 240
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        onAnswer(text)
    }
}
