import MarkdownView
import SwiftUI

/// One Inbox question: who asked (the name opens that Bot or Task), when, the
/// question and its markdown body, then its answers: `QuestionOptions`, each option the
/// same pill and "Other… · Skip" a line of text, pinned to the bottom on iPhone for one
/// question. An integration question and a plan keep their own controls. A secret is asked for with the task's own `SecretCard`,
/// which says the question itself.
struct InboxQuestionView: View {
    let inbox: OpenQuestions
    let question: BotQuestion
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL


    private var wide: Bool { sizeClass == .regular }

    /// On iPhone one question's options, single- or multi-select, sit at the bottom under the
    /// question; several questions scroll with it, as they may not fit there.
    private var pinned: Bool { question.choices?.count == 1 }

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
                if wide || !pinned { answers.padding(.top, 24) }
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
            if !wide, pinned {
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
        if let choices = question.choices {
            QuestionOptions(questions: choices, typed: question.typed, onSubmit: { answer($0) }) { skip }
        } else if let part = question.secretPart {
            // Saved in the conversation that asked; the listing then drops the question.
            AskedSecretCard(question: question, part: part, teamId: inbox.teamId) { Task { await inbox.refresh() } }
        } else if question.connectable {
            QuestionConnect(questions: inbox, question: question, height: wide ? 40 : 50, size: wide ? 15 : 16, fill: !wide)
        }
    }

    private var skip: some View {
        QuestionTextButton(title: String(localized: "Skip")) { inbox.selected = inbox.next(after: question.id) }
            .disabled(inbox.list.count < 2 && wide)
    }

    private func answer(_ answer: DecisionAnswer) {
        Task { await inbox.hold(question, with: answer) }
    }

    /// Nuphos pages open in the app, as a conversation's links do; anything else leaves.
    private func open(link url: URL) {
        if !PushNotifications.shared.open(url) { openURL(url) }
    }
}

/// An action as a capsule, as a connect question's: dark when `primary`, light otherwise.
struct InboxOption: View {
    let title: String
    let primary: Bool
    let height: CGFloat
    let size: CGFloat
    var fill = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: size, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(primary ? Theme.chatCanvas : Theme.heading)
                .padding(.horizontal, 20)
                .frame(maxWidth: fill ? .infinity : nil, minHeight: height)
                .background(primary ? Theme.heading : Theme.control, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
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

/// The answer in words, with its send button.
struct AnswerField: View {
    @Binding var words: String
    var focused: FocusState<Bool>.Binding
    let send: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            TextField("Your answer", text: $words, axis: .vertical)
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
            .accessibilityLabel("Send answer")
            .disabled(words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }
}
