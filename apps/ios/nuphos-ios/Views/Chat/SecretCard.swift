import SwiftUI

/// A secret the agent asked for, like the desktop's `SecretCard`: a masked
/// field whose value goes straight to a file on the agent's runtime. Only the
/// file's path is sent as the reply; the value never enters the transcript.
struct SecretCard: View {
    let part: ChatPart.ToolPart
    /// Someone already replied after the question.
    var answered: Bool
    let session: ChatSession

    private enum Phase { case idle, saving, sent, failed(String) }

    @State private var value = ""
    @State private var phase = Phase.idle

    private var name: String { part.secretRequest?.name ?? "" }
    private var reason: String { part.secretRequest?.reason ?? "" }
    private var sent: Bool { if case .sent = phase { true } else { false } }
    private var saving: Bool { if case .saving = phase { true } else { false } }

    /// Why the value can't be sent right now; nil when it can.
    private var blocked: String? {
        if !session.ownsChat { return "Only the owner of this conversation can provide this secret." }
        if answered { return "This request is closed. Ask the agent to request the secret again." }
        if session.isStreaming { return "The agent is working. You can send this when its turn ends." }
        return nil
    }

    var body: some View {
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
            if sent {
                Label("Saved on the agent's runtime.", systemImage: "checkmark.circle.fill")
                    .font(Theme.Text.label).foregroundStyle(Theme.muted)
            } else {
                HStack(spacing: 8) {
                    SecureField("Paste the value", text: $value)
                        .font(Theme.Text.mono(.footnote))
                        .textContentType(.password)
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
                Text(blocked ?? "The value is written to a file on the agent's runtime and never appears in this conversation.")
                    .font(Theme.Text.caption).foregroundStyle(Theme.muted)
            }
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
                phase = .failed("Could not save it on the agent's runtime: \(error.localizedDescription)")
            }
        }
    }
}
