import SwiftUI

/// The desktop's Inbox ("Needs your input"): every open question across the
/// viewer's conversations, newest first, each answered from its card. "From …"
/// opens the conversation that asked, on top of the Inbox.
struct InboxPage: View {
    @Environment(AgentStore.self) private var store
    let inbox: OpenQuestions?

    @State private var opened: AgentPage.OpenChat?

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .refreshable { await inbox?.refresh() }
            .navigationDestination(item: $opened) { chat in
                if let session = chat.session {
                    ConversationView(session: session, sourcePage: HomePage.inbox.rawValue)
                        .readWhileShown(session)
                        // An answer given there leaves the Inbox on return.
                        .onDisappear { Task { await inbox?.refresh() } }
                }
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
                                onOpen: {
                                    opened = AgentPage.OpenChat(session: store.session(
                                        sessionId: question.sessionId, title: question.title, teamId: inbox.teamId))
                                },
                                onAnswer: { text in Task { await inbox.answer(question, with: text) } },
                                failure: inbox.failures[question.id])
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
}
