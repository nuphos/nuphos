import SwiftUI

/// A secret the agent asked for, like the desktop's `SecretCard`: a masked
/// field whose value goes straight to a file on the agent's runtime. Only the
/// file's path is sent as the reply; the value never enters the transcript.
/// With `fields` it asks for a website form's details together and names the site.
struct SecretCard: View {
    let part: ChatPart.ToolPart
    /// The first reply after the question, once there is one.
    var reply: String?
    let session: ChatSession

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
        if !session.ownsChat { return "Only the owner of this task can provide this secret." }
        if session.isStreaming { return "The agent is working. You can send this when its turn ends." }
        return nil
    }

    var body: some View {
        if saved {
            line("lock.fill", "\(subject) saved on the task's runtime.")
        } else if reply != nil {
            line("lock.slash", "\(subject) request closed. Ask the agent to request it again.")
        } else {
            card
        }
    }

    /// The answered card: one line, no field.
    private func line(_ symbol: String, _ text: String) -> some View {
        Label(text, systemImage: symbol)
            .font(Theme.Text.label)
            .foregroundStyle(Theme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "lock.fill").font(Theme.Text.caption).foregroundStyle(Theme.muted)
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
                    Button(revealed ? "Hide values" : "Reveal values") { revealed.toggle() }
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
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    /// What the card says of where the values go; for a form, only that filling it in bypasses the task.
    private var note: String {
        if let site {
            return "The values are written to files on the task's runtime and entered on \(site) without passing through this task."
        }
        return "The value is written to a file on the task's runtime and never appears in this task."
    }

    /// One field of a form's details: masked until the person reveals the values.
    @ViewBuilder
    private func input(_ index: Int, label: String) -> some View {
        Group {
            if revealed {
                TextField(label, text: value(index))
            } else {
                SecureField(label, text: value(index))
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
            Text(saving ? "Saving…" : "Send securely")
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
            } catch {
                phase = .failed("Could not save it on the task's runtime: \(error.localizedDescription)")
            }
        }
    }
}
