import SwiftUI

/// An open question in a Bot's chat, laid out as the Inbox lays one out: who asked, when another
/// conversation did, the question as the heading, what the agent wrote to decide it from, then
/// its answers: `QuestionOptions`, the options, "Other…" to answer in words in the card and "Skip"
/// to withdraw the question unanswered, one row of the same pill. A multi-select or
/// several questions pick the same pills and send them at once. An answer wakes the agent
/// that asked; no message is sent. A secret is asked for with the task's own `SecretCard`, saved
/// and replied to in the conversation that asked. A connect question opens that conversation's
/// credential picker, as in the Inbox. `showsFrom` is off for the Bot's own questions in its own chat.
struct BotQuestionCard: View {
    let question: BotQuestion
    var showsFrom = true
    let onOpen: () -> Void
    /// The chat's team: a secret is saved in the conversation that asked.
    let teamId: String
    /// The chat's open questions: a connect question's picker saves through them, and they say why
    /// the last answer or save failed while the question is still open.
    let questions: OpenQuestions
    let onAnswer: (DecisionAnswer) -> Void
    let onSkip: () -> Void
    /// A tapped link in the body. Absent, the system opens it.
    var onLink: ((URL) -> Void)?

    @State private var expanded = false
    /// The secret was sent: nothing is left to skip while the listing catches up.
    @State private var saved = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL

    private var wide: Bool { sizeClass == .regular }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let part = question.secretPart { secret(part, teamId) } else { card }
            // Read here, not passed in: the transcript redraws a row only when the row itself changes.
            if let failure = questions.failures[question.id] {
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
    private func secret(_ part: ChatPart.ToolPart, _ teamId: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if showsFrom {
                QuestionSource(question: question, prominent: true, identifier: "botQuestion.source", open: onOpen)
            }
            AskedSecretCard(question: question, part: part, teamId: teamId) { saved = true }
            if !saved { skip }
        }
        .frame(maxWidth: wide ? 640 : nil, alignment: .leading)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsFrom {
                QuestionSource(question: question, prominent: true, identifier: "botQuestion.source", open: onOpen)
                    .padding(.bottom, 6)
            }
            QuestionTitle(text: question.request.question, size: 17, identifier: "botQuestion.title")
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
        if let choices = question.choices {
            QuestionOptions(questions: choices, typed: question.typed, onSubmit: onAnswer) { skip }
        } else {
            let connect = QuestionConnect(questions: questions, question: question, height: wide ? 40 : 44, size: 15, fill: !wide)
            VStack(alignment: .leading, spacing: 8) {
                connect
                skip
            }
        }
    }

    private var skip: some View {
        QuestionPill(title: String(localized: "Skip"), action: onSkip)
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
                        LucideIcon(systemName: expanded ? "chevron.up" : "chevron.down").font(.system(size: 16, weight: .semibold))
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

/// A question card's options, one design for every question: the options, "Other…" and `trailing`
/// (Skip) one wrapping row of the same pill, as Paper draws a choice. One question with one answer is
/// answered by a tap; a multi-select, or several questions, pick theirs (a check once picked) and
/// send them with Send, the row's one ink button, at its end. Here and in the Inbox; the desktop's
/// `DecisionOptions`.
struct QuestionOptions<Trailing: View>: View {
    let questions: [AgentConversation.DecisionQuestion]
    /// It may be answered in words, with "Other…".
    let typed: Bool
    let onSubmit: (DecisionAnswer) -> Void
    @ViewBuilder let trailing: () -> Trailing

    @State private var picked: [[String]]
    @State private var words: [String]
    /// The question whose "Other…" is open; only its words answer it.
    @State private var open: Int?
    @FocusState private var focused: Bool

    init(questions: [AgentConversation.DecisionQuestion], typed: Bool,
         onSubmit: @escaping (DecisionAnswer) -> Void, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.questions = questions
        self.typed = typed
        self.onSubmit = onSubmit
        self.trailing = trailing
        _picked = State(initialValue: questions.map { _ in [] })
        _words = State(initialValue: questions.map { _ in "" })
        // One question answered only in words has its box open from the start.
        _open = State(initialValue: typed && questions.count == 1 && (questions[0].options ?? []).isEmpty ? 0 : nil)
    }

    /// One question with one answer: a tap answers it.
    private var instant: Bool { questions.count == 1 && questions[0].multiSelect != true }

    private var typedWords: [String] { questions.indices.map { open == $0 ? words[$0] : "" } }

    private var complete: Bool {
        questions.indices.allSatisfy {
            !picked[$0].isEmpty || !typedWords[$0].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func send() {
        guard complete else { return }
        focused = false
        onSubmit(BotQuestion.formAnswer(questions, picked: picked, typed: typedWords))
    }

    private func tap(_ option: String, at index: Int) {
        if instant { return onSubmit(DecisionAnswer(choices: [option])) }
        if picked[index].contains(option) {
            picked[index].removeAll { $0 == option }
        } else {
            picked[index] = questions[index].multiSelect == true ? picked[index] + [option] : [option]
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(questions.indices, id: \.self) { index in
                if questions.count > 1 {
                    Text(questions[index].question)
                        .font(Theme.Text.label.weight(.medium))
                        .foregroundStyle(Theme.heading)
                        .padding(.top, index > 0 ? 8 : 0)
                }
                let options = questions[index].options ?? []
                // One row of the same pill: the options, "Other…", and on the last row `trailing` and Send.
                FlowLayout(spacing: 8) {
                    ForEach(options, id: \.self) { option in
                        QuestionPill(title: option, checked: instant ? nil : picked[index].contains(option)) {
                            tap(option, at: index)
                        }
                    }
                    if typed {
                        QuestionPill(title: options.isEmpty ? String(localized: "Reply…") : String(localized: "Other…"), on: open == index) {
                            open = open == index ? nil : index
                            focused = open != nil
                        }
                    }
                    if index == questions.count - 1 {
                        trailing()
                        if !instant { sendButton }
                    }
                }
                if open == index {
                    AnswerField(words: $words[index], focused: $focused, send: send)
                }
            }
        }
    }

    /// Send, the row's one ink button, for the picks.
    private var sendButton: some View {
        Button(action: send) {
            Text("Send")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.chatCanvas)
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .background(Theme.heading, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!complete)
        .opacity(complete ? 1 : 0.4)
    }
}

/// An option, the same pill for every one as Paper draws it: the raised surface, a hairline ring and
/// a soft shadow, radius 9, hugging its words. `checked`, it is picked rather than sent: a check once picked.
struct QuestionPill: View {
    let title: String
    var checked: Bool?
    /// Its box is open, as "Other…" while typing.
    var on = false
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if checked == true { LucideIcon("check").font(.system(size: 14, weight: .semibold)) }
                Text(title).font(.system(size: 15)).multilineTextAlignment(.leading)
            }
            .foregroundStyle(Theme.heading)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .frame(minHeight: 44)
            .background(on ? Theme.control : Theme.surface, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .shadow(color: .black.opacity(0.04), radius: 1, y: 1)
            .shadow(color: .black.opacity(0.06), radius: 4, y: 3)
            .contentShape(Rectangle())
            .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(checked == true || on ? .isSelected : [])
    }
}

/// Its views left to right, wrapping onto the next line when the width runs out.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    private func rows(_ width: CGFloat, _ subviews: Subviews) -> [[(index: Int, size: CGSize)]] {
        var rows: [[(index: Int, size: CGSize)]] = [[]]
        var x: CGFloat = 0
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + size.width > width {
                rows.append([])
                x = 0
            }
            rows[rows.count - 1].append((index, size))
            x += size.width + spacing
        }
        return rows
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(width, subviews)
        let height = rows.map { $0.map(\.size.height).max() ?? 0 }.reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        let widest = rows.map { $0.map(\.size.width).reduce(0, +) + spacing * CGFloat(max($0.count - 1, 0)) }.max() ?? 0
        return CGSize(width: proposal.width ?? widest, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(bounds.width, subviews) {
            var x = bounds.minX
            let height = row.map(\.size.height).max() ?? 0
            for item in row {
                subviews[item.index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += height + spacing
        }
    }
}
