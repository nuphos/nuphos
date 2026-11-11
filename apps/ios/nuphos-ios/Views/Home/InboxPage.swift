import SwiftUI

/// The desktop's Inbox ("Needs your input"): every open question across the
/// viewer's conversations, newest first, each answered from its card. "From …"
/// opens the conversation that asked, as a notification does.
struct InboxPage: View {
    let inbox: OpenQuestions?

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.canvas)
            .refreshable { await inbox?.refresh() }
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
                                onAnswer: { text in Task { await inbox.answer(question, with: text) } },
                                failure: inbox.failures[question.id],
                                // Opens the conversation, its composer answering this question.
                                onReply: { open(question, in: inbox, answering: true) })
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

    /// As a notification opens one: on the Tasks page, its composer answering the question for "Other…".
    private func open(_ question: BotQuestion, in inbox: OpenQuestions, answering: Bool = false) {
        PushNotifications.shared.pendingTarget = PushTarget(
            teamId: inbox.teamId, sessionId: question.sessionId, title: question.title,
            answering: answering ? question.request : nil)
    }
}
