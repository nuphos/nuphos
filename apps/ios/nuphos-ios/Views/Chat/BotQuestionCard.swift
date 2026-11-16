import SwiftUI

/// An open question in a Bot's chat, laid out as the Inbox lays one out: who asked, when another
/// conversation did, the question as the heading, what the agent wrote to decide it from, then
/// its answers. The first option is the dark one; "Other…" asks for the answer in words in the
/// card and "Skip" withdraws the question unanswered. On iPhone the options are full-width with
/// "Other…" and "Skip" as outlined halves below; wide, one row of capsules with "Skip" at its end.
/// A multi-select or several questions are a form, sent as one answer. An answer wakes the agent
/// that asked; no message is sent. A secret is asked for with the task's own `SecretCard`, saved
/// and replied to in the conversation that asked. A connect question is answered in that
/// conversation, which the button opens. `showsFrom` is off for the Bot's own questions in its own chat.
struct BotQuestionCard: View {
    let question: BotQuestion
    var showsFrom = true
    let onOpen: () -> Void
    /// The conversation that asked, where a secret is saved and its reply sent.
    var asker: (() -> ChatSession)?
    let onAnswer: (DecisionAnswer) -> Void
    let onSkip: () -> Void
    /// A tapped link in the body. Absent, the system opens it.
    var onLink: ((URL) -> Void)?
    /// Why the last answer could not be sent; the question is still open.
    var failure: String?

    @State private var expanded = false
    /// "Other…" was tapped: the card asks for the answer in words.
    @State private var typing = false
    @State private var words = ""
    @State private var session: ChatSession?
    @FocusState private var focused: Bool
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL

    private var wide: Bool { sizeClass == .regular }

    /// The one-tap answers, possibly none; nil when only the conversation can answer it.
    private var options: [String]? {
        if ["credential", "integration"].contains(question.request.category) { return nil }
        let options = (question.request.options ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        // Neither an option nor words answer it here.
        return options.isEmpty && !question.typed ? nil : options
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let part = question.secretPart, let asker { secret(part, asker) } else { card }
            if let failure {
                Label("Couldn't send the message · \(failure)", systemImage: "exclamationmark.circle")
                    .font(Theme.Text.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("botQuestion.failure")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("botQuestion.card")
    }

    /// A secret: who asked, then the task's own card, sending in the conversation that asked.
    private func secret(_ part: ChatPart.ToolPart, _ asker: @escaping () -> ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsFrom {
                QuestionSource(question: question, prominent: true, identifier: "botQuestion.source", open: onOpen)
            }
            // Whether the viewer may send it is known once the conversation loads.
            if let session, session.loaded {
                SecretCard(part: part, reply: nil, session: session)
                HStack(spacing: 8) { Color.clear.frame(maxWidth: .infinity); skip }
            }
        }
        .frame(maxWidth: wide ? 640 : nil, alignment: .leading)
        .task { if session == nil { session = asker() } }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsFrom {
                QuestionSource(question: question, prominent: true, identifier: "botQuestion.source", open: onOpen)
                    .padding(.bottom, 6)
            }
            Text(question.request.question)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Theme.heading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let body = question.ownBody {
                questionBody(body).padding(.top, 4)
            }
            // "Show more" is its own 44pt of room above the answers.
            answers.padding(.top, question.ownBody.map(BotQuestion.isLongBody) == true ? 0 : 12)
        }
        .padding(EdgeInsets(top: 14, leading: 16, bottom: 10, trailing: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        // Wide, the body's lines stay readable.
        .frame(maxWidth: wide ? 640 : nil)
    }

    @ViewBuilder private var answers: some View {
        if let form = question.form {
            DecisionForm(questions: form, onSubmit: onAnswer)
            HStack { Spacer(); skip }.padding(.top, 12)
        } else if let options {
            VStack(alignment: .leading, spacing: wide ? 10 : 8) {
                if wide {
                    // One row, Skip at its end; long options take the row and the outlined two the next.
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { buttons(for: options); other; Spacer(minLength: 10); skip }
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(spacing: 10) { buttons(for: options) }
                            HStack(spacing: 10) { other; Spacer(minLength: 10); skip }
                        }
                    }
                    if typing { field }
                } else {
                    buttons(for: options)
                    // "Other…" gives its row to the text box.
                    if typing {
                        field
                    } else {
                        HStack(spacing: 8) {
                            if question.typed { other } else { Color.clear.frame(maxWidth: .infinity) }
                            skip
                        }
                    }
                }
            }
        } else {
            let open = InboxOption(title: String(localized: "Answer in the task"), primary: true,
                                   height: wide ? 40 : 44, size: 15, fill: !wide, action: onOpen)
            if wide {
                HStack(spacing: 10) { open; Spacer(); skip }
            } else {
                VStack(spacing: 8) {
                    open
                    HStack(spacing: 8) { Color.clear.frame(maxWidth: .infinity); skip }
                }
            }
        }
    }

    private func buttons(for options: [String]) -> some View {
        ForEach(Array(options.enumerated()), id: \.element) { index, option in
            InboxOption(title: option, primary: index == 0, height: wide ? 40 : 44, size: wide ? 15 : 16, fill: !wide) {
                onAnswer(DecisionAnswer(choices: [option]))
            }
        }
    }

    /// "Other…" beside options; "Reply…" when there are none. A plan or a secret is never answered in words.
    @ViewBuilder private var other: some View {
        let title = options?.isEmpty == true ? String(localized: "Reply…") : String(localized: "Other…")
        if question.typed {
            InboxOutlineButton(title: title, fill: !wide, toggled: typing) {
                typing.toggle()
                focused = typing
            }
        }
    }

    private var skip: some View {
        InboxOutlineButton(title: String(localized: "Skip"), fill: !wide, action: onSkip)
    }

    private var field: some View {
        AnswerField(words: $words, focused: $focused) {
            let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { onAnswer(DecisionAnswer(text: text)) }
        }
    }

    /// The question's markdown body: four lines (84pt) at first, the last fading out, and a full-width
    /// "Show more" for the rest. The collapsed body opens it too.
    @ViewBuilder private func questionBody(_ text: String) -> some View {
        let long = BotQuestion.isLongBody(text)
        let collapsed = long && !expanded
        VStack(alignment: .leading, spacing: 0) {
            AssistantMarkdown(text: text, theme: InboxQuestionView.bodyTheme, onLink: { onLink?($0) ?? openURL($0) })
                .frame(maxHeight: collapsed ? 84 : nil, alignment: .top)
                .clipped()
                .mask(LinearGradient(
                    stops: [.init(color: .black, location: collapsed ? 54.0 / 84 : 1), .init(color: collapsed ? .clear : .black, location: 1)],
                    startPoint: .top, endPoint: .bottom))
                .overlay {
                    if collapsed { Color.clear.contentShape(Rectangle()).onTapGesture { expanded = true } }
                }
                .accessibilityIdentifier("botQuestion.body")
            if long {
                Button { expanded.toggle() } label: {
                    HStack(spacing: 6) {
                        Text(expanded ? "Show less" : "Show more").font(.system(size: 15, weight: .semibold))
                        Image(systemName: expanded ? "chevron.up" : "chevron.down").font(.system(size: 16, weight: .semibold))
                    }
                    .foregroundStyle(Theme.heading)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("botQuestion.more")
            }
        }
    }
}

/// The desktop's `DecisionForm`, here and in the Inbox: each question's options toggled, one or any
/// number, or the answer typed in their place, sent together as one answer.
struct DecisionForm: View {
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
