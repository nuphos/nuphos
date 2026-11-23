import SwiftUI

/// The secure input card of a question shown away from its conversation, in a Bot's chat or the
/// Inbox: the value is saved, and the reply sent, in the conversation that asked. It shows once
/// that conversation has loaded, since whether the viewer may send to it is known only then.
struct AskedSecretCard: View {
    @Environment(AgentStore.self) private var store
    let question: BotQuestion
    let part: ChatPart.ToolPart
    let teamId: String
    var onSaved: (() -> Void)?
    @State private var session: ChatSession?

    var body: some View {
        if let session, session.loaded {
            SecretCard(part: part, reply: nil, session: session, onSaved: onSaved)
        } else {
            // An empty view runs no task, so this stands in until the conversation has loaded.
            Color.clear.frame(height: 0)
                .task { if session == nil { session = store.session(sessionId: question.sessionId, title: question.title, teamId: teamId) } }
        }
    }
}

/// A secret the agent asked for, like the desktop's `SecretCard`: a masked
/// field whose value goes straight to a file on the agent's runtime. Only the
/// file's path is sent as the reply; the value never enters the transcript.
/// With `fields` it asks for a website form's details together and names the site.
struct SecretCard: View {
    let part: ChatPart.ToolPart
    /// The first reply after the question, once there is one.
    var reply: String?
    let session: ChatSession
    /// The value reached the runtime from this card.
    var onSaved: (() -> Void)?

    private enum Phase { case idle, saving, sent, failed(String) }

    /// One value per field; a single secret is the only one.
    @State private var values: [String] = []
    @State private var revealed = false
    @State private var phase = Phase.idle

    private var name: String { part.secretRequest?.name ?? "" }
    private var reason: String { part.secretRequest?.reason ?? "" }
    private var fields: [ChatPart.ToolPart.SecretField]? { part.secretRequest?.fields }
    private var site: String? { part.secretRequest?.site }
    /// What the one-line states name: the site of a form's details, else the secret.
    private var subject: String { site ?? name }
    private var count: Int { fields?.count ?? 1 }
    private var complete: Bool { values.count == count && values.allSatisfy { !$0.isEmpty } }
    private func value(_ index: Int) -> Binding<String> {
        Binding(
            get: { values.indices.contains(index) ? values[index] : "" },
            set: { new in
                if values.count != count { values = Array(repeating: "", count: count) }
                values[index] = new
            }
        )
    }
    private var sent: Bool { if case .sent = phase { true } else { false } }
    /// The value reached the runtime: sent from here, or the reply says so (Desktop sends the same text).
    private var saved: Bool { sent || reply?.hasPrefix(ChatPart.ToolPart.secretSavedReply(name)) == true }
    private var saving: Bool { if case .saving = phase { true } else { false } }

    /// Why the value can't be sent right now; nil when it can.
    private var blocked: String? {
        if !session.ownsChat { return String(localized: "Only the owner of this task can provide this secret.") }
        if session.isStreaming { return String(localized: "Still working. You can send this when the turn ends.") }
        return nil
    }

    var body: some View {
        if saved {
            line("lock.fill", "\(subject) saved on the task's runtime.")
        } else if reply != nil {
            line("lock.slash", "\(subject) request closed. Ask here to request it again.")
        } else {
            card
        }
    }

    /// The answered card: one line, no field.
    private func line(_ symbol: String, _ text: LocalizedStringKey) -> some View {
        DesignLabel(text, systemImage: symbol)
            .font(Theme.Text.label)
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                LucideIcon("lock").font(Theme.Text.caption).foregroundStyle(Theme.muted)
                if let site {
                    Text("Details needed for \(site)").foregroundStyle(Theme.heading)
                } else {
                    Text("Secret needed: ").foregroundStyle(Theme.heading)
                        + Text(name).font(Theme.Text.mono(.subheadline)).foregroundStyle(Theme.heading)
                }
            }
            .font(Theme.Text.secondary.weight(.medium))
            if !reason.isEmpty {
                Text(reason).font(Theme.Text.label).foregroundStyle(Theme.body)
            }
            if let fields {
                ForEach(Array(fields.enumerated()), id: \.offset) { index, field in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(field.label).font(Theme.Text.label).foregroundStyle(Theme.body)
                        input(index, label: field.label)
                    }
                }
                .disabled(blocked != nil)
                HStack {
                    Button { revealed.toggle() } label: { revealed ? Text("Hide values") : Text("Reveal values") }
                        .buttonStyle(.plain)
                        .font(Theme.Text.caption).foregroundStyle(Theme.muted)
                    Spacer()
                    sendButton
                }
            } else {
                HStack(spacing: 8) {
                    SecureField("Paste the value", text: value(0))
                        .font(Theme.Text.mono(.footnote))
                        .autocorrectionDisabled()
                        #if canImport(UIKit)
                        .textInputAutocapitalization(.never)
                        #endif
                        .submitLabel(.send)
                        .onSubmit(submit)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Theme.chatCanvas, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
                    sendButton
                }
                .disabled(blocked != nil)
            }
            if case .failed(let message) = phase {
                Text(message).font(Theme.Text.caption).foregroundStyle(.red)
            }
            Text(blocked ?? note)
                .font(Theme.Text.caption).foregroundStyle(Theme.muted)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .raisedCard()
    }

    /// What the card says of where the values go; for a form, only that filling it in bypasses the task.
    private var note: String {
        if let site {
            return String(localized: "The values are written to files on the task's runtime and entered on \(site) without passing through this task.")
        }
        return String(localized: "The value is written to a file on the task's runtime and never appears in this task.")
    }

    /// One field of a form's details: masked until the person reveals the values.
    @ViewBuilder
    private func input(_ index: Int, label: String) -> some View {
        Group {
            // The label sits above the input, so the input itself carries no prompt.
            if revealed {
                TextField("", text: value(index))
            } else {
                SecureField("", text: value(index))
            }
        }
        .font(Theme.Text.mono(.footnote))
        .autocorrectionDisabled()
        #if canImport(UIKit)
        .textInputAutocapitalization(.never)
        #endif
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(Theme.chatCanvas, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .accessibilityLabel(label)
    }

    private var sendButton: some View {
        Button(action: submit) {
            saving ? Text("Saving…") : Text("Send securely")
        }
        .prominentButton()
        .controlSize(.small)
        .font(Theme.Text.label.weight(.medium))
        .disabled(!complete || saving || blocked != nil)
    }

    private func submit() {
        guard complete, !saving, blocked == nil else { return }
        let secrets = values
        phase = .saving
        Task {
            do {
                try await session.provideSecret(secrets, for: part)
                values = []
                phase = .sent
                onSaved?()
            } catch {
                phase = .failed(String(localized: "Could not save it on the task's runtime: \(error.localizedDescription)"))
            }
        }
    }
}
