import MarkdownView
import SwiftUI

/// One Inbox question: who asked (the name opens that Bot or Task), when, the
/// question and its markdown body, then its answers. On iPhone the options are
/// full-width buttons pinned to the bottom with "Other…" and "Skip" as outlined halves
/// below; wide, a row of capsules with an outlined "Skip" at its end. A form, an integration question
/// and a plan keep their own controls.
struct InboxQuestionView: View {
    @Environment(AgentStore.self) private var store
    let inbox: OpenQuestions
    let question: BotQuestion
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.openURL) private var openURL

    /// "Other…" was tapped: the text box and its send button show.
    @State private var typing = false
    @State private var words = ""
    @FocusState private var focused: Bool

    /// The integration question whose conversation's credentials are being chosen, while the picker shows.
    @State private var connecting = false
    /// That conversation's selection, as stored and as edited in the picker.
    @State private var stored = CredentialSelection()
    @State private var selection = CredentialSelection()

    private var wide: Bool { sizeClass == .regular }

    /// The one-tap answers; nil when this question is not answered with them.
    private var options: [String]? {
        guard question.form == nil, !["credential", "integration"].contains(question.request.category) else { return nil }
        let options = (question.request.options ?? []).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        return options.isEmpty && !question.typed ? nil : options
    }

    /// Margins: iPhone 20 at the sides, right under the bar; iPad 56 and 25 from the top. A wide
    /// iPhone, as iPhone Duo's inner display, takes 40 leading and 51 from the top, and nothing more
    /// on the trailing side: the safe area there, wide enough for the Duo's status column, is the margin.
    private var margins: (top: CGFloat, leading: CGFloat, trailing: CGFloat) {
        guard wide else { return (0, 20, 20) }
        return UIDevice.current.userInterfaceIdiom == .pad ? (25, 56, 56) : (51, 40, 0)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                source
                Text(question.request.question)
                    .font(.system(size: 22, weight: .semibold))
                    .tracking(-0.2)
                    .lineSpacing(3)
                    .foregroundStyle(Theme.heading)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 10)
                if let body = question.ownBody {
                    AssistantMarkdown(text: body, theme: Self.bodyTheme, onLink: open(link:))
                        .padding(.top, 18)
                        .accessibilityIdentifier("inbox.body")
                }
                if wide || options == nil { answers.padding(.top, 24) }
                if let failure = inbox.failures[question.id] {
                    Label("Couldn't send the answer · \(failure)", systemImage: "exclamationmark.circle")
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
            if !wide, options != nil {
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
            if wide { InboxToast(inbox: inbox).padding(.bottom, 32).ignoresSafeArea(.container, edges: .bottom) }
        }
        .animation(.snappy, value: inbox.toast)
        .animation(.snappy, value: typing)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if !wide {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Open \(question.title)", systemImage: "arrow.up.right") { open(link: question.link(team: inbox.teamId)) }
                }
            }
        }
        .sheet(isPresented: $connecting, onDismiss: save) {
            CredentialPickerSheet(selection: $selection).presentationDetents([.medium, .large])
        }
    }

    /// The body as the design sets it: 15pt in the body color, 12 between paragraphs and 8 between list items.
    private static var bodyTheme: MarkdownTheme {
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

    /// The source's icon and name, which opens it, then when it asked. On iPhone the name is
    /// muted like the time, since the bar's ↗ opens it too; wide, it is dark with its own ↗.
    private var source: some View {
        HStack(spacing: 6) {
            Button { open(link: question.link(team: inbox.teamId)) } label: {
                HStack(spacing: 6) {
                    AgentAvatar(agentId: question.sessionId, runtime: question.runtime, size: 16, showBadge: false)
                    Text(question.title).lineLimit(1)
                        .fontWeight(wide ? .medium : .regular)
                        .foregroundStyle(wide ? Theme.heading : Theme.muted)
                    if wide {
                        Image(systemName: "arrow.up.right").font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Theme.heading)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("inbox.source")
            if let asked = question.askedDate {
                Text("·")
                Text(HistoryTime.format(asked)).lineLimit(1)
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(Theme.muted)
    }

    @ViewBuilder private var answers: some View {
        if let form = question.form {
            DecisionForm(questions: form) { answer($0) }
            HStack { Spacer(); skip }.padding(.top, 12)
        } else if let options {
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
                        skip
                    }
                } else {
                    ForEach(Array(options.enumerated()), id: \.element) { index, option in
                        InboxOption(title: option, primary: index == 0, height: 50, size: 16, fill: true) {
                            answer(DecisionAnswer(choices: [option]))
                        }
                    }
                    // Two halves; Skip keeps the right one when there is no Other….
                    HStack(spacing: 10) {
                        if question.typed, !options.isEmpty { otherButton } else { Color.clear.frame(maxWidth: .infinity) }
                        skip
                    }
                }
                if typing || (options.isEmpty && question.typed) { field }
            }
        } else if question.connectable {
            InboxOption(title: connectLabel, primary: true, height: wide ? 40 : 50, size: wide ? 15 : 16, fill: !wide) {
                Task { await connect() }
            }
        } else {
            Text("Answer it in \(question.title).")
                .font(.system(size: 15))
                .foregroundStyle(Theme.muted)
        }
    }

    /// "Other…": the text box and its send button, or put away again.
    private func other() {
        typing.toggle()
        focused = typing
    }

    /// The answer in words, with its send button.
    private var field: some View {
        HStack(spacing: 8) {
            TextField("Your answer", text: $words, axis: .vertical)
                .font(.system(size: 16))
                .lineLimit(1...5)
                .focused($focused)
                .onSubmit(sendWords)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .frame(minHeight: 44)
                .background(Theme.chatCanvas, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.fieldBorder, lineWidth: 1))
            Button(action: sendWords) {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Theme.chatCanvas)
                    .frame(width: 44, height: 44)
                    .background(Theme.heading, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Send answer")
            .disabled(words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, wide ? 0 : -4)
    }

    private var otherButton: some View {
        InboxOutlineButton(title: String(localized: "Other…"), fill: !wide, toggled: typing, action: other)
    }

    private var skip: some View {
        InboxOutlineButton(title: String(localized: "Skip"), fill: !wide) { inbox.selected = inbox.next(after: question.id) }
            .disabled(inbox.list.count < 2 && wide)
    }

    private func sendWords() {
        let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        answer(DecisionAnswer(text: text))
    }

    private func answer(_ answer: DecisionAnswer) {
        focused = false
        Task { await inbox.hold(question, with: answer) }
    }

    /// Nuphos pages open in the app, as a conversation's links do; anything else leaves.
    private func open(link url: URL) {
        if !PushNotifications.shared.open(url) { openURL(url) }
    }

    /// "Use your own GitHub" for a question naming the member's own credential; otherwise the picker.
    private var connectLabel: String {
        guard let own = question.personalCredentials else { return String(localized: "Choose credentials") }
        let names = own.map { $0 == "github" ? "GitHub" : $0 == "linear" ? "Linear" : $0 }
        return String(localized: "Use your own \(names.joined(separator: " and "))")
    }

    /// Opens the picker on the asking conversation's own selection, so saving keeps what it had.
    private func connect() async {
        // The member's own credential: added as named, with no picker and no team connection in its place.
        if let own = question.personalCredentials {
            await store.loadCredentialOptions()
            let connected = store.credentialCatalog.map { catalog in
                Set(catalog.allItems.filter { $0.provider.selectionKey == "personalCredentialIds" }.map(\.id))
            }
            await inbox.useOwn(own, for: question, connected: connected)
            return
        }
        guard let current = await inbox.storedSelection(for: question) else { return }
        stored = current
        selection = current
        connecting = true
    }

    /// Saves the picker's selection when it changed; the server answers the question it covers.
    private func save() {
        guard selection != stored else { return }
        let chosen = selection
        let question = question
        Task { await inbox.select(chosen, for: question) }
    }
}

/// An Inbox answer as a capsule: the first one dark, the rest light.
private struct InboxOption: View {
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

/// Other… and Skip: an outlined capsule, filled light instead while toggled. Half the row on
/// iPhone at 44pt; wide, as wide as its title at 40pt.
private struct InboxOutlineButton: View {
    let title: String
    let fill: Bool
    var toggled = false
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(Theme.heading)
                .padding(.horizontal, 18)
                .frame(maxWidth: fill ? .infinity : nil, minHeight: fill ? 44 : 40)
                .background(toggled ? Theme.control : .clear, in: Capsule())
                .overlay { if !toggled { Capsule().strokeBorder(Theme.outline, lineWidth: 1) } }
                .contentShape(Capsule())
                .opacity(enabled ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(toggled ? .isSelected : [])
    }
}
