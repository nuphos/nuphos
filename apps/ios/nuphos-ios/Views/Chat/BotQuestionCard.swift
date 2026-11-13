import SwiftUI

/// An open question, in a Bot's chat or the Inbox, like the desktop's decision
/// card: which agent asked, the question and what the agent wrote to decide it
/// from, each option an answer, and "Other…" to type the answer in the card
/// (in the Inbox, the text box is always there). A
/// multi-select or several questions are a form, sent as one answer. An answer
/// wakes the agent that asked; no message is sent. A connect or secure-input question is answered in the
/// conversation that asked, which the link opens. `showsFrom` is off for the
/// Bot's own questions in its own chat.
struct BotQuestionCard: View {
    let question: BotQuestion
    var showsFrom = true
    let onOpen: () -> Void
    let onAnswer: (DecisionAnswer) -> Void
    /// A tapped link in the body. Absent, the system opens it.
    var onLink: ((URL) -> Void)?
    /// Why the last answer could not be sent; the question is still open.
    var failure: String?
    /// Chooses the asking conversation's credentials here, for an integration question; absent where it cannot.
    var onConnect: (() -> Void)?
    /// The text box is always on the card, rather than behind "Other…", as the Inbox shows it.
    var answersInPlace = false

    @State private var expanded = false
    /// "Other…" was tapped: the card asks for the answer in words.
    @State private var typing = false
    @Environment(\.openURL) private var openURL

    /// One answer per option, possibly none; nil when only the conversation can answer it.
    private var replies: [(label: String, answer: DecisionAnswer)]? {
        if ["credential", "integration"].contains(question.request.category) { return nil }
        let options = (question.request.options ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        // Neither an option nor words answer it here.
        if options.isEmpty && !question.typed { return nil }
        return options.map { ($0, DecisionAnswer(choices: [$0])) }
    }

    /// "Use your own GitHub" for a question naming the member's own credential; otherwise the picker.
    private var connectLabel: String {
        guard let own = question.personalCredentials else { return String(localized: "Choose credentials") }
        let names = own.map { $0 == "github" ? "GitHub" : $0 == "linear" ? "Linear" : $0 }
        return String(localized: "Use your own \(names.joined(separator: " and "))")
    }

    /// "Other…" beside options; "Reply…" when there are none.
    private var replyLabel: LocalizedStringKey {
        (question.request.options ?? []).contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ? "Other…" : "Reply…"
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
                if let body = question.ownBody {
                    questionBody(body)
                }
                if let form = question.form {
                    DecisionForm(questions: form, onSubmit: onAnswer)
                } else if let replies {
                    if !replies.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(replies, id: \.label) { reply in
                                Button(reply.label) { onAnswer(reply.answer) }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                    .tint(Theme.heading)
                            }
                        }
                    }
                    if question.typed && (typing || answersInPlace) {
                        // The answer in words: the same form with the question alone and no options.
                        DecisionForm(questions: [.init(question: question.request.question)], onSubmit: onAnswer)
                    } else if question.typed {
                        Button(replyLabel) { typing = true }
                            .font(Theme.Text.label)
                            .foregroundStyle(Theme.muted)
                            .buttonStyle(.plain)
                    }
                } else if let onConnect, question.connectable {
                    Button(connectLabel, action: onConnect)
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(Theme.heading)
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
            if let failure {
                Label("Couldn't send the message · \(failure)", systemImage: "exclamationmark.circle")
                    .font(Theme.Text.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("botQuestion.failure")
            }
        }
        .accessibilityIdentifier("botQuestion.card")
    }

    /// The question's markdown body: a few lines at first, "Show more" for the rest, as on the desktop.
    @ViewBuilder private func questionBody(_ text: String) -> some View {
        let long = BotQuestion.isLongBody(text)
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
}

/// The desktop's `DecisionForm`: each question's options toggled, one or any
/// number, or the answer typed in their place, sent together as one answer.
private struct DecisionForm: View {
    let questions: [AgentConversation.DecisionQuestion]
    let onSubmit: (DecisionAnswer) -> Void

    @State private var picked: [[String]]
    @State private var typed: [String]

    init(questions: [AgentConversation.DecisionQuestion], onSubmit: @escaping (DecisionAnswer) -> Void) {
        self.questions = questions
        self.onSubmit = onSubmit
        _picked = State(initialValue: questions.map { _ in [] })
        _typed = State(initialValue: questions.map { _ in "" })
    }

    private var answers: [String] {
        questions.indices.map { BotQuestion.answerText(picked: picked[$0], typed: typed[$0]) }
    }

    private func toggle(_ option: String, at index: Int) {
        if picked[index].contains(option) {
            picked[index].removeAll { $0 == option }
        } else {
            picked[index] = questions[index].multiSelect == true ? picked[index] + [option] : [option]
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(questions.indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 8) {
                    if questions.count > 1 {
                        Text(questions[index].question)
                            .font(Theme.Text.label.weight(.medium))
                            .foregroundStyle(Theme.heading)
                    }
                    ForEach(questions[index].options ?? [], id: \.self) { option in
                        let on = picked[index].contains(option)
                        Button { toggle(option, at: index) } label: {
                            Label(option, systemImage: on ? "checkmark.circle.fill" : "circle")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(on ? Theme.brand : Theme.heading)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                    TextField(
                        (questions[index].options ?? []).isEmpty ? "Your answer" : "Or type your own answer",
                        text: $typed[index]
                    )
                    .textFieldStyle(.roundedBorder)
                    .font(Theme.Text.label)
                }
            }
            Button("Send answer") { onSubmit(BotQuestion.formAnswer(questions, picked: picked, typed: typed)) }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(answers.contains { $0.isEmpty })
        }
    }
}
