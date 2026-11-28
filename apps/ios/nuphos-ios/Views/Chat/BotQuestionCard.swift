import SwiftUI

/// An open question in a Bot's chat, laid out as the Inbox lays one out: who asked, when another
/// conversation did, the question as the heading, what the agent wrote to decide it from, then
/// its answers: `QuestionOptions`, the options, "Other…" to answer in words in the card and "Dismiss"
/// to close the question unanswered, telling the agent, one row of the same pill. A multi-select or
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
    let onDismiss: () -> Void
    /// A tapped link in the body. Absent, the system opens it.
    var onLink: ((URL) -> Void)?

    @State private var expanded = false
    @State private var form: QuestionForm
    /// The secret was sent: nothing is left to dismiss while the listing catches up.
    @State private var saved = false
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL

    private var wide: Bool { sizeClass == .regular }

    init(question: BotQuestion, showsFrom: Bool = true, onOpen: @escaping () -> Void, teamId: String,
         questions: OpenQuestions, onAnswer: @escaping (DecisionAnswer) -> Void,
         onDismiss: @escaping () -> Void, onLink: ((URL) -> Void)? = nil) {
        self.question = question
        self.showsFrom = showsFrom
        self.onOpen = onOpen
        self.teamId = teamId
        self.questions = questions
        self.onAnswer = onAnswer
        self.onDismiss = onDismiss
        self.onLink = onLink
        _form = State(initialValue: QuestionForm(question.choices ?? [], typed: question.typed))
    }

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
            if !saved { dismiss }
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
            if let desktop = question.request.desktop {
                ComputerPreview(teamId: teamId, sessionId: question.sessionId, desktop: desktop, bot: question.title) {
                    onAnswer(DecisionAnswer(choices: [question.request.options?.first ?? "I'm done"]))
                }
                .padding(.top, 12)
            }
            // "Show more" is its own 44pt of room above the answers.
            answers.padding(.top, question.ownBody.map(BotQuestion.isLongBody) == true ? 0 : 12)
        }
        .padding(EdgeInsets(top: 14, leading: 16, bottom: 10, trailing: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .raisedCard()
        // Wide, the body's lines stay readable.
        .frame(maxWidth: wide ? 640 : nil)
    }

    @ViewBuilder private var answers: some View {
        if question.choices != nil {
            QuestionOptions(form: $form, typed: question.typed, onSubmit: onAnswer) { dismiss }
        } else {
            let connect = QuestionConnect(questions: questions, question: question, height: wide ? 40 : 44, size: 15, fill: !wide)
            VStack(alignment: .leading, spacing: 8) {
                connect
                dismiss
            }
        }
    }

    /// Closes the question unanswered, telling the agent. A chat offers no Snooze: that sets a
    /// question aside in the Inbox.
    private var dismiss: some View {
        QuestionPill(title: String(localized: "Dismiss"), action: onDismiss)
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

/// A question card's options, one design for every question. One question with one answer is
/// answered by a tap: its options, "Other…" and `trailing` (Snooze and Dismiss) one wrapping row of
/// the same pill. A multi-select, or several questions, is a form: each question picks its options or
/// "Other" with its words under it, and one footer, `QuestionFooter`, sends them. Here and in the
/// Inbox; the desktop's `DecisionOptions`.
struct QuestionOptions<Trailing: View>: View {
    @Binding var form: QuestionForm
    /// It may be answered in words, with "Other…".
    let typed: Bool
    let onSubmit: (DecisionAnswer) -> Void
    /// Off where the caller pins the footer apart, as the iPhone Inbox does.
    var footer = true
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(form.questions.indices, id: \.self) { index in
                question(index).padding(.top, index > 0 ? 24 : 0)
            }
            if footer, !form.instant {
                QuestionFooter(form: form, onSubmit: onSubmit, trailing: trailing).padding(.top, 16)
            }
        }
    }

    private func question(_ index: Int) -> some View {
        let options = form.questions[index].options ?? []
        return VStack(alignment: .leading, spacing: 0) {
            if form.questions.count > 1 {
                QuestionHeader(number: index + 1, question: form.questions[index], answered: form.answered(index))
                    .padding(.bottom, 12)
            }
            FlowLayout(spacing: 8) {
                ForEach(options, id: \.self) { option in
                    QuestionPill(title: option, checked: form.instant ? nil : form.picked[index].contains(option)) {
                        if form.instant { return onSubmit(DecisionAnswer(choices: [option])) }
                        form.pick(option, at: index)
                    }
                }
                if typed, !options.isEmpty {
                    if form.instant {
                        QuestionPill(title: String(localized: "Other…"), on: form.other[index]) { form.pickOther(at: index) }
                    } else {
                        QuestionPill(title: form.other[index] ? String(localized: "Other") : String(localized: "Other…"),
                                     checked: form.other[index]) { form.pickOther(at: index) }
                    }
                }
                if form.instant { trailing() }
            }
            if form.other[index] {
                // Focused only when "Other…" opened it; a question with nothing to pick shows it from the
                // start, unfocused. A form's words have no send of their own: Return sends a complete card.
                OtherField(words: $form.words[index], focus: !options.isEmpty, arrow: form.instant) {
                    if form.left == 0 { onSubmit(form.answer) }
                }
                .padding(.top, 10)
            }
        }
    }
}

/// A form's one footer: `trailing` (Snooze and Dismiss), then Send, which says how many questions
/// are left until every one is answered.
struct QuestionFooter<Trailing: View>: View {
    let form: QuestionForm
    let onSubmit: (DecisionAnswer) -> Void
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        let ready = form.left == 0
        HStack(spacing: 8) {
            trailing()
            Spacer(minLength: 0)
            Button { onSubmit(form.answer) } label: {
                Text(ready ? "Send" : "Answer \(form.left) more")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ready ? Theme.surface : Theme.muted)
                    .lineLimit(1)
                    .padding(.horizontal, ready ? 18 : 16)
                    .frame(minHeight: 44)
                    .background(ready ? Theme.heading : Theme.sunken, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(ready ? .clear : Theme.hairline, lineWidth: 1))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!ready)
            .accessibilityIdentifier("question.send")
        }
    }
}

/// A form question's heading: its number in a ring until it is answered, then a check.
private struct QuestionHeader: View {
    let number: Int
    let question: AgentConversation.DecisionQuestion
    let answered: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                if answered {
                    Circle().fill(Theme.heading)
                    LucideIcon("check").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.surface)
                } else {
                    Circle().strokeBorder(Theme.stamp, lineWidth: 1.5)
                    Text(verbatim: "\(number)").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.muted)
                }
            }
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)
            Text(question.question)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.heading)
                .frame(maxWidth: .infinity, alignment: .leading)
            if question.multiSelect == true {
                Text("Choose any").font(.system(size: 13)).foregroundStyle(Theme.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(answered ? Text("Answered") : Text(""))
    }
}

/// "Other"'s words, focused when it is picked rather than shown from the start.
private struct OtherField: View {
    @Binding var words: String
    let focus: Bool
    let arrow: Bool
    let send: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        AnswerField(words: $words, focused: $focused, arrow: arrow, send: send)
            .onAppear { if focus { focused = true } }
    }
}

/// An option, the same pill for every one as Paper draws it: the raised surface, a hairline ring and
/// a soft shadow, radius 9, hugging its words. `checked`, it is picked rather than sent: a check once picked.
struct QuestionPill: View {
    let title: String
    var checked: Bool?
    /// Its box is open, as a one-tap question's "Other…" while typing or Dismiss while asking for the reason.
    var on = false
    let action: () -> Void

    var body: some View {
        Button(action: action) { QuestionPillLabel(title: title, checked: checked, on: on) }
            .buttonStyle(.plain)
            .accessibilityAddTraits(checked == true || on ? .isSelected : [])
    }
}

/// The pill itself, for a button or a menu's label, as Snooze's.
struct QuestionPillLabel: View {
    let title: String
    var checked: Bool?
    var on = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
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
