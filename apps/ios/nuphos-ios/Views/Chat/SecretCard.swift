import SwiftUI

/// A secret the agent asked for, like the desktop's `SecretCard`: a masked
/// field whose value goes straight to a file on the agent's runtime. Only the
/// file's path is sent as the reply; the value never enters the transcript.
struct SecretCard: View {
    let part: ChatPart.ToolPart
    /// The first reply after the question, once there is one.
    var reply: String?
    let session: ChatSession

    private enum Phase { case idle, saving, sent, failed(String) }

    @State private var value = ""
    @State private var phase = Phase.idle

    private var name: String { part.secretRequest?.name ?? "" }
    private var reason: String { part.secretRequest?.reason ?? "" }
    private var sent: Bool { if case .sent = phase { true } else { false } }
    /// The value reached the runtime: sent from here, or the reply says so (Desktop sends the same text).
    private var saved: Bool { sent || reply?.hasPrefix(Self.savedReply(name)) == true }

    /// The reply that answers the request, before the file's path; the desktop's text.
    static func savedReply(_ name: String) -> String { "🔒 \(name) saved to " }
    private var saving: Bool { if case .saving = phase { true } else { false } }

    /// Why the value can't be sent right now; nil when it can.
    private var blocked: String? {
        if !session.ownsChat { return "Only the owner of this task can provide this secret." }
        if session.isStreaming { return "The agent is working. You can send this when its turn ends." }
        return nil
    }

    var body: some View {
        if saved {
            line("lock.fill", "\(name) saved on the task's runtime.")
        } else if reply != nil {
            line("lock.slash", "\(name) request closed. Ask the agent to request it again.")
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
                Text("Secret needed: ").foregroundStyle(Theme.heading)
                    + Text(name).font(Theme.Text.mono(.subheadline)).foregroundStyle(Theme.heading)
            }
            .font(Theme.Text.secondary.weight(.medium))
            if !reason.isEmpty {
                Text(reason).font(Theme.Text.label).foregroundStyle(Theme.body)
            }
            HStack(spacing: 8) {
                SecureField("Paste the value", text: $value)
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
                Button(action: submit) {
                    Text(saving ? "Saving…" : "Send securely")
                }
                .prominentButton()
                .controlSize(.small)
                .font(Theme.Text.label.weight(.medium))
                .disabled(value.isEmpty || saving || blocked != nil)
            }
            .disabled(blocked != nil)
            if case .failed(let message) = phase {
                Text(message).font(Theme.Text.caption).foregroundStyle(.red)
            }
            Text(blocked ?? "The value is written to a file on the task's runtime and never appears in this task.")
                .font(Theme.Text.caption).foregroundStyle(Theme.muted)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
    }

    private func submit() {
        guard !value.isEmpty, !saving, blocked == nil else { return }
        let secret = value
        phase = .saving
        Task {
            do {
                try await session.provideSecret(secret, for: part)
                value = ""
                phase = .sent
            } catch {
                phase = .failed("Could not save it on the task's runtime: \(error.localizedDescription)")
            }
        }
    }
}
