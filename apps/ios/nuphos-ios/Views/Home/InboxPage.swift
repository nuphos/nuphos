import SwiftUI

/// The desktop's Inbox ("Needs your input"): every open question across the
/// viewer's conversations, newest first, each answered from its card. "From …"
/// opens the conversation that asked, as a notification does. An integration
/// question is answered here, in the asking conversation's credential picker.
struct InboxPage: View {
    @Environment(AgentStore.self) private var store
    let inbox: OpenQuestions?

    /// The integration question whose conversation's credentials are being chosen, while the picker shows.
    @State private var connecting: BotQuestion?
    /// The same question, kept past the picker's dismissal for saving.
    @State private var target: BotQuestion?
    /// That conversation's selection, as stored and as edited in the picker.
    @State private var stored = CredentialSelection()
    @State private var selection = CredentialSelection()

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .refreshable { await inbox?.refresh() }
            .sheet(item: $connecting, onDismiss: save) { _ in
                CredentialPickerSheet(selection: $selection).presentationDetents([.medium, .large])
            }
    }

    @ViewBuilder
    private var content: some View {
        if let inbox, inbox.loaded {
            ScrollView {
                if inbox.list.isEmpty {
                    ContentUnavailableView(
                        "You're all caught up",
                        systemImage: "tray",
                        description: Text("When an agent needs you to decide something, it shows up here. Answer it and it leaves the Inbox."))
                } else {
                    LazyVStack(spacing: 18) {
                        ForEach(inbox.list.reversed()) { question in
                            BotQuestionCard(
                                question: question,
                                onOpen: { open(question, in: inbox) },
                                onAnswer: { answer in Task { await inbox.answer(question, with: answer) } },
                                failure: inbox.failures[question.id],
                                onConnect: { Task { await connect(question, in: inbox) } },
                                answersInPlace: true)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .readableWidth()
                }
            }
        } else {
            ProgressView().tint(Theme.muted)
        }
    }

    /// Opens the picker on the asking conversation's own selection, so saving keeps what it had.
    private func connect(_ question: BotQuestion, in inbox: OpenQuestions) async {
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
        target = question
        connecting = question
    }

    /// Saves the picker's selection when it changed; the server answers the question it covers.
    private func save() {
        guard let inbox, let question = target, selection != stored else { return }
        let chosen = selection
        Task { await inbox.select(chosen, for: question) }
    }

    /// As a notification opens one: the asking conversation, on the Tasks page.
    private func open(_ question: BotQuestion, in inbox: OpenQuestions) {
        PushNotifications.shared.pendingTarget = PushTarget(
            teamId: inbox.teamId, sessionId: question.sessionId, title: question.title, answering: nil)
    }
}
