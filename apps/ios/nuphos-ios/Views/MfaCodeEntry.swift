import SwiftUI

/// Asks for a code from the authenticator app, or a recovery code instead. A
/// full six-digit code submits by itself. `submit` throws when the code is
/// refused; the reason then shows under the field.
struct MfaCodeEntry: View {
    let submitLabel: LocalizedStringKey
    let submit: (String) async throws -> Void
    /// Offered when the account may answer with a passkey instead.
    var passkey: (() async throws -> Void)? = nil

    @State private var code = ""
    @State private var recovery = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var complete: Bool {
        recovery ? !code.trimmingCharacters(in: .whitespaces).isEmpty : code.count == 6
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField(recovery ? "xxxx-xxxx-xxxx-xxxx" : "000000", text: $code)
                .font(.title3.monospaced())
                .multilineTextAlignment(.center)
                #if os(iOS)
                .keyboardType(recovery ? .asciiCapable : .numberPad)
                .textInputAutocapitalization(.never)
                .textContentType(recovery ? nil : .oneTimeCode)
                #endif
                .autocorrectionDisabled()
                .focused($focused)
                .padding(.horizontal, 16).frame(minHeight: 52)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("mfa.code")
                .onChange(of: code) { old, new in
                    error = nil
                    guard !recovery else { return }
                    let digits = String(new.filter(\.isNumber).prefix(6))
                    if digits != new { code = digits; return }
                    if digits.count == 6, old.count != 6 { Task { await send() } }
                }
            if let error {
                Text(error).font(.footnote).foregroundStyle(.red).accessibilityIdentifier("mfa.error")
            }
            Button {
                Task { await send() }
            } label: {
                HStack {
                    if busy { ProgressView() }
                    Text(busy ? "Verifying…" : submitLabel)
                }.frame(maxWidth: .infinity, minHeight: 20)
            }
            .buttonStyle(.borderedProminent).controlSize(.large).buttonBorderShape(.capsule)
            .disabled(!complete || busy)
            if let passkey {
                Button("Use a passkey") {
                    Task {
                        busy = true
                        defer { busy = false }
                        do { try await passkey() } catch Passkeys.Failure.cancelled {} catch { self.error = error.localizedDescription }
                    }
                }
                .font(.subheadline).buttonStyle(.plain).foregroundStyle(Theme.body).frame(minHeight: 44)
                .disabled(busy).accessibilityIdentifier("mfa.passkey")
            }
            Button(recovery ? "Use your authenticator app" : "Use a recovery code") {
                recovery.toggle(); code = ""; error = nil; focused = true
            }
            .font(.subheadline).buttonStyle(.plain).foregroundStyle(Theme.body).frame(minHeight: 44)
        }
        .onAppear { focused = true }
    }

    private func send() async {
        guard complete, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await submit(code)
        } catch {
            self.error = error.localizedDescription
            code = ""
        }
    }
}

/// The step-up prompt: shown over everything while a request waits for a code.
struct StepUpSheet: View {
    @Bindable var prompt: StepUpPrompt
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Enter a code from your authenticator app to continue.")
                    .foregroundStyle(Theme.body)
                MfaCodeEntry(submitLabel: "Continue", submit: { try await prompt.submit(code: $0) },
                             passkey: { try await prompt.submitPasskey() })
                Spacer()
            }
            .padding(24)
            .navigationTitle("Confirm it’s you")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { prompt.cancel() } }
            }
        }
        .presentationDetents([.medium])
        // Cancel answers the waiting request; a swipe would leave it hanging.
        .interactiveDismissDisabled()
        .onChange(of: prompt.token) { _, token in if token == nil { dismiss() } }
    }
}
