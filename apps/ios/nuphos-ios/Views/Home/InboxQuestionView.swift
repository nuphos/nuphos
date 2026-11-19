import MarkdownView
import SwiftUI

/// One Inbox question: who asked (the name opens that Bot or Task), when, the
/// question and its markdown body, then its answers. On iPhone the options are
/// full-width buttons pinned to the bottom with "Other…", "Snooze" and "Dismiss" outlined
/// below; wide, a row of capsules with an outlined "Snooze" and "Dismiss" at its end. A form, an
/// integration question and a plan keep their own controls, with Snooze and Dismiss under them. A
/// secret is asked for with the task's own `SecretCard`, which says the question itself. Snooze sets
/// it aside until one of its times; Dismiss asks for an optional reason for the agent.
struct InboxQuestionView: View {
    let inbox: OpenQuestions
    let question: BotQuestion
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL

    /// "Other…" was tapped: the text box and its send button show.
    @State private var typing = false
    @State private var words = ""
    /// "Dismiss" was tapped: the reason box and its Dismiss show.
    @State private var dismissing = false
    @State private var reason = ""
    @FocusState private var focused: Bool

    private var wide: Bool { sizeClass == .regular }

    /// Margins: iPhone 20 at the sides, right under the bar; iPad 56 and 25 from the top. A wide
    /// iPhone, as iPhone Duo's inner display, takes 40 / 16 and 51 from the top: the 16 is past the
    /// Duo's status column, which the safe area already keeps clear.
    private var margins: (top: CGFloat, leading: CGFloat, trailing: CGFloat) {
        guard wide else { return (0, 20, 20) }
        return UIDevice.current.userInterfaceIdiom == .pad ? (25, 56, 56) : (51, 40, 16)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                source
                if question.secretPart == nil {
                    QuestionTitle(text: question.request.question, size: 22, tracking: -0.2, identifier: "inbox.title")
                        .padding(.top, 10)
                }
                if let body = question.ownBody {
                    AssistantMarkdown(text: body, theme: Self.bodyTheme, onLink: open(link:))
                        .padding(.top, 18)
                        .accessibilityIdentifier("inbox.body")
                }
                if wide || question.options == nil { answers.padding(.top, 24) }
                if let failure = inbox.failures[question.id] {
                    Label("Couldn't send the answer · \(failure)", image: "lucide-circle-alert")
                        .font(Theme.Text.caption)
                        .foregroundStyle(.red)
                        .padding(.top, 12)
                        .accessibilityIdentifier("inbox.failure")
                }
            }
            .padding(.leading, margins.leading)
            .padding(.trailing, margins.trailing)
            .padding(.top, margins.top)
            .padding(.bottom, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.canvas.ignoresSafeArea())
        // Wide, the list and the question share the canvas: a hairline parts them.
        .overlay(alignment: .leading) {
            if wide { Theme.separator.frame(width: 0.5).ignoresSafeArea() }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !wide, question.options != nil {
                answers
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .background(Theme.canvas)
                    // Floats 12 above the options.
                    .overlay(alignment: .top) { InboxToast(inbox: inbox).alignmentGuide(.top) { $0[.bottom] + 12 } }
            }
        }
        .overlay(alignment: .bottom) {
            // 32 from the screen's bottom edge, not the home indicator's.
            // Centred on the question's text, inside its margins.
            if wide {
                InboxToast(inbox: inbox)
                    .padding(.leading, margins.leading)
                    .padding(.trailing, margins.trailing)
                    .padding(.bottom, 32)
                    .ignoresSafeArea(.container, edges: .bottom)
            }
        }
        .animation(.snappy, value: inbox.toast)
        .animation(.snappy, value: typing)
        .animation(.snappy, value: dismissing)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if !wide {
                ToolbarItem(placement: .topBarTrailing) {
                    DesignButton("Open \(question.title)", image: "lucide-arrow-up-right") { open(link: question.link(team: inbox.teamId)) }
                }
            }
        }
    }

    /// The body as the design sets it: 15pt in the body color, 12 between paragraphs and 8 between list items.
    static var bodyTheme: MarkdownTheme {
        var theme = AssistantMarkdown.theme
        #if canImport(UIKit)
        theme.colors.body = UIColor(Theme.body)
        theme.fonts.body = Theme.Text.uiFont(.subheadline)
        theme.fonts.bold = Theme.Text.uiFont(.subheadline, weight: .semibold)
        theme.fonts.italic = Theme.Text.italicUIFont(.subheadline)
        #endif
        theme.spacings.paragraph = 12
        theme.spacings.list = 8
        theme.sizes.bullet = 5
        return theme
    }

    /// On iPhone the name is muted like the time, since the bar's ↗ opens it too.
    private var source: some View {
        QuestionSource(question: question, prominent: wide, identifier: "inbox.source") {
            open(link: question.link(team: inbox.teamId))
        }
    }

    @ViewBuilder private var answers: some View {
        if let form = question.form {
            DecisionForm(questions: form) { answer($0) }
            HStack(spacing: 10) { Spacer(); setAside }.padding(.top, 12)
            if dismissing { reasonField }
        } else if let options = question.options {
            VStack(alignment: .leading, spacing: 10) {
                if wide {
                    HStack(spacing: 10) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ForEach(Array(options.enumerated()), id: \.element) { index, option in
                                    InboxOption(title: option, primary: index == 0, height: 40, size: 15) {
                                        answer(DecisionAnswer(choices: [option]))
                                    }
                                }
                                if question.typed, !options.isEmpty { otherButton }
                            }
                        }
                        .scrollClipDisabled()
                        setAside
                    }
                } else {
                    ForEach(Array(options.enumerated()), id: \.element) { index, option in
                        InboxOption(title: option, primary: index == 0, height: 50, size: 16, fill: true) {
                            answer(DecisionAnswer(choices: [option]))
                        }
                    }
                    // Thirds, or halves when there is no Other….
                    HStack(spacing: 10) {
                        if question.typed, !options.isEmpty { otherButton }
                        setAside
                    }
                }
                if dismissing { reasonField } else if typing || (options.isEmpty && question.typed) { field }
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if let part = question.secretPart {
                    // Saved in the conversation that asked; the listing then drops the question.
                    AskedSecretCard(question: question, part: part, teamId: inbox.teamId) { Task { await inbox.refresh() } }
                } else if question.connectable {
                    QuestionConnect(questions: inbox, question: question, height: wide ? 40 : 50, size: wide ? 15 : 16, fill: !wide)
                }
                HStack(spacing: 10) {
                    if wide { Spacer() }
                    setAside
                }
                .padding(.top, 12)
                if dismissing { reasonField.padding(.top, 10) }
            }
        }
    }

    /// "Other…": the text box and its send button, or put away again.
    private func other() {
        typing.toggle()
        dismissing = false
        focused = typing
    }

    private var field: some View {
        AnswerField(words: $words, focused: $focused, send: sendWords)
            .padding(.horizontal, wide ? 0 : -4)
    }

    private var otherButton: some View {
        InboxOutlineButton(title: String(localized: "Other…"), fill: !wide, toggled: typing, action: other)
    }

    /// Snooze, a menu of its times, and Dismiss, which asks for the reason first.
    @ViewBuilder private var setAside: some View {
        Menu {
            ForEach(Snooze.times(from: .now), id: \.self) { time in
                Button(time.label) { Task { await inbox.snooze(question, until: time.until) } }
            }
        } label: {
            InboxOutline(title: String(localized: "Snooze"), fill: !wide)
        }
        .buttonStyle(.plain)
        InboxOutlineButton(title: String(localized: "Dismiss"), fill: !wide, toggled: dismissing) {
            dismissing.toggle()
            typing = false
            focused = dismissing
        }
    }

    private var reasonField: some View {
        AnswerField(words: $reason, focused: $focused, prompt: "Reason (optional)",
                    sendLabel: "Dismiss question", optional: true) {
            focused = false
            Task { await inbox.hold(question, with: .dismiss(reason: Snooze.reason(reason))) }
        }
        .padding(.horizontal, wide ? 0 : -4)
        // As Desktop's field, it takes no more than the server keeps.
        .onChange(of: reason) { _, text in
            if text.count > Snooze.reasonLimit { reason = String(text.prefix(Snooze.reasonLimit)) }
        }
    }

    private func sendWords() {
        let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        answer(DecisionAnswer(text: text))
    }

    private func answer(_ answer: DecisionAnswer) {
        focused = false
        Task { await inbox.hold(question, with: .answer(answer)) }
    }

    /// Nuphos pages open in the app, as a conversation's links do; anything else leaves.
    private func open(link url: URL) {
        if !PushNotifications.shared.open(url) { openURL(url) }
    }
}

/// An answer as a capsule, in the Inbox and on a chat's question card: the first one dark, the rest light.
/// An option says what the agent wrote, often a whole sentence, so one too long for a line wraps onto
/// as many as it needs and the capsule grows with it, as the Desktop card's options do. Its corners stay
/// `height / 2`, which is the capsule it has always been while the title fits one line.
struct InboxOption: View {
    let title: String
    let primary: Bool
    let height: CGFloat
    let size: CGFloat
    var fill = false
    let action: () -> Void

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: height / 2) }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: size, weight: .semibold))
                .multilineTextAlignment(.center)
                .foregroundStyle(primary ? Theme.chatCanvas : Theme.heading)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .frame(maxWidth: fill ? .infinity : nil, minHeight: height)
                .background(primary ? Theme.heading : Theme.control, in: shape)
                .contentShape(shape)
        }
        .buttonStyle(.plain)
    }
}

/// Other…, Snooze and Dismiss: an outlined capsule, filled light instead while toggled. A share of
/// the row on iPhone at 44pt; wide, as wide as its title at 40pt.
struct InboxOutlineButton: View {
    let title: String
    let fill: Bool
    var toggled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) { InboxOutline(title: title, fill: fill, toggled: toggled) }
            .buttonStyle(.plain)
            .accessibilityAddTraits(toggled ? .isSelected : [])
    }
}

/// The outlined capsule itself, for a button or a menu's label.
struct InboxOutline: View {
    let title: String
    let fill: Bool
    var toggled = false
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Text(title)
            .font(.system(size: 15, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(Theme.heading)
            .padding(.horizontal, 14)
            .frame(maxWidth: fill ? .infinity : nil, minHeight: fill ? 44 : 40)
            .background(toggled ? Theme.control : .clear, in: Capsule())
            .overlay { if !toggled { Capsule().strokeBorder(Theme.outline, lineWidth: 1) } }
            .contentShape(Capsule())
            .opacity(enabled ? 1 : 0.4)
    }
}

/// Who asked: the source's icon and name, which opens it, then when it asked. `prominent`, the
/// name is dark with its own ↗.
struct QuestionSource: View {
    let question: BotQuestion
    let prominent: Bool
    let identifier: String
    let open: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            Button(action: open) {
                HStack(spacing: 6) {
                    AgentAvatar(agentId: question.sessionId, runtime: question.runtime, size: 16, showBadge: false)
                    Text(question.title).lineLimit(1)
                        .fontWeight(prominent ? .medium : .regular)
                        .foregroundStyle(prominent ? Theme.heading : Theme.muted)
                    if prominent {
                        LucideIcon("arrow-up-right").font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.heading)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier(identifier)
            if let asked = question.askedDate {
                Text("·")
                Text(HistoryTime.format(asked)).lineLimit(1)
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(Theme.muted)
    }
}

/// The answer in words, with its send button; or, `optional`, words that may be left out, such as
/// a dismissal's reason.
struct AnswerField: View {
    @Binding var words: String
    var focused: FocusState<Bool>.Binding
    var prompt: LocalizedStringKey = "Your answer"
    var sendLabel: LocalizedStringKey = "Send answer"
    var optional = false
    let send: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField(prompt, text: $words, axis: .vertical)
                .font(.system(size: 16))
                .lineLimit(1...5)
                .focused(focused)
                .onSubmit(send)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: 44)
                .background(Theme.chatCanvas, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.faint, lineWidth: 1))
            Button(action: send) {
                LucideIcon("arrow-up")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.chatCanvas)
                    .frame(width: 44, height: 44)
                    .background(Theme.heading, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(sendLabel)
            .disabled(!optional && words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }
}
