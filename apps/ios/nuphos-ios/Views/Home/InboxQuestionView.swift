import SwiftUI

/// One Inbox question: who asked (the name opens that Bot or Task), when, the
/// question and its markdown body, then its answers. On iPhone the options are
/// full-width buttons pinned to the bottom with "Other…" and "Skip" below; wide,
/// a row of capsules with "Skip" at its end. A form, an integration question
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                source
                Text(question.request.question)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.heading)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                if let body = question.ownBody {
                    AssistantMarkdown(text: body, theme: AssistantMarkdown.bubbleTheme, onLink: open(link:))
                        .accessibilityIdentifier("inbox.body")
                }
                if wide || options == nil { answers }
                if let failure = inbox.failures[question.id] {
                    Label("Couldn't send the answer · \(failure)", systemImage: "exclamationmark.circle")
                        .font(Theme.Text.caption)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("inbox.failure")
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .readableWidth()
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.chatCanvas.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !wide, options != nil { answers.padding(.horizontal, 20).padding(.vertical, 12).background(Theme.chatCanvas) }
        }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(isPresented: $connecting, onDismiss: save) {
            CredentialPickerSheet(selection: $selection).presentationDetents([.medium, .large])
        }
    }

    /// The source's icon and name, which opens it, then when it asked.
    private var source: some View {
        HStack(spacing: 6) {
            Button { open(link: question.link(team: inbox.teamId)) } label: {
                HStack(spacing: 6) {
                    AgentAvatar(agentId: question.sessionId, runtime: question.runtime, size: 20, showBadge: false)
                    Text(question.title).lineLimit(1)
                    Image(systemName: "arrow.up.right").font(.caption.weight(.semibold))
                }
                .foregroundStyle(Theme.heading)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("inbox.source")
            if let asked = question.askedDate {
                Text("·").foregroundStyle(Theme.muted)
                Text(HistoryTime.format(asked)).foregroundStyle(Theme.muted).lineLimit(1)
            }
        }
        .font(Theme.Text.label.weight(.medium))
    }

    @ViewBuilder private var answers: some View {
        if let form = question.form {
            DecisionForm(questions: form) { answer($0) }
            skip.frame(maxWidth: .infinity, alignment: .trailing)
        } else if let options {
            VStack(alignment: .leading, spacing: 10) {
                if wide {
                    HStack(spacing: 8) {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(options, id: \.self) { option in
                                    Button(option) { answer(DecisionAnswer(choices: [option])) }
                                        .buttonStyle(.bordered)
                                        .buttonBorderShape(.capsule)
                                        .tint(Theme.heading)
                                }
                                if question.typed { otherButton.buttonStyle(.bordered).buttonBorderShape(.capsule).tint(Theme.muted) }
                            }
                        }
                        skip
                    }
                } else {
                    ForEach(options, id: \.self) { option in
                        Button { answer(DecisionAnswer(choices: [option])) } label: {
                            Text(option).frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .buttonBorderShape(.roundedRectangle(radius: 14))
                        .tint(Theme.heading)
                    }
                    HStack {
                        if question.typed { otherButton.buttonStyle(.plain).foregroundStyle(Theme.muted) }
                        Spacer()
                        skip
                    }
                    .font(Theme.Text.body)
                    .padding(.horizontal, 4)
                }
                if typing || (options.isEmpty && question.typed) { other }
            }
        } else if question.connectable {
            Button(connectLabel) { Task { await connect() } }
                .buttonStyle(.bordered)
                .tint(Theme.heading)
        } else {
            Text("Answer it in the conversation that asked.")
                .font(Theme.Text.label)
                .foregroundStyle(Theme.muted)
        }
    }

    /// "Other…" beside options; nothing to open when there are none, the box is already there.
    @ViewBuilder private var otherButton: some View {
        if !(options ?? []).isEmpty {
            Button("Other…") {
                typing = true
                focused = true
            }
        }
    }

    /// The answer in words, with its send button.
    private var other: some View {
        HStack(spacing: 8) {
            TextField("Your answer", text: $words, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit(sendWords)
            Button("Send answer", systemImage: "arrow.up.circle.fill", action: sendWords)
                .labelStyle(.iconOnly)
                .font(.title2)
                .tint(Theme.brand)
                .disabled(words.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private var skip: some View {
        Button("Skip") { inbox.selected = inbox.next(after: question.id) }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.muted)
            .disabled(inbox.list.count < 2 && wide)
    }

    private func sendWords() {
        let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        answer(DecisionAnswer(text: text))
    }

    private func answer(_ answer: DecisionAnswer) {
        focused = false
        Task { await inbox.answer(question, with: answer) }
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
