import CoreImage.CIFilterBuiltins
import SwiftUI

/// Account → Two-factor authentication: turn it on with an authenticator app,
/// see how many recovery codes are left, replace them, or turn it off. Matches
/// Desktop's `TwoFactorSection`.
struct TwoFactorView: View {
    @Environment(AuthSession.self) private var session
    /// Signs out so the user can sign back in, when turning it on needs a fresh sign-in.
    let onSignOut: () -> Void

    private enum Load: Equatable {
        case loading
        case ready(AccountAPI.MfaStatus)
        case setup(AccountAPI.MfaSetup)
        /// Shown once, right after turning it on or replacing them.
        case codes([String])
        case signInAgain
        case failed(String)
    }

    private enum Confirm: Identifiable, Equatable {
        case disable, codes
        case removePasskey(AccountAPI.Passkey)
        var id: String {
            switch self {
            case .disable: "disable"
            case .codes: "codes"
            case .removePasskey(let passkey): "passkey-\(passkey.id)"
            }
        }
        var title: LocalizedStringKey {
            switch self {
            case .disable: "Turn off two-factor authentication"
            case .codes: "Replace your recovery codes"
            case .removePasskey: "Remove passkey"
            }
        }
        var text: LocalizedStringKey {
            switch self {
            case .disable: "Sign-in will no longer ask for a code. Enter one to confirm."
            case .codes: "Your current recovery codes will stop working. Enter a code to confirm."
            case .removePasskey: "This passkey will no longer work for this account. Enter a code to confirm."
            }
        }
        var action: LocalizedStringKey {
            switch self {
            case .disable: "Turn off"
            case .codes: "Replace codes"
            case .removePasskey: "Remove"
            }
        }
    }

    @State private var load = Load.loading
    @State private var busy = false
    @State private var confirming: Confirm?
    @State private var actionError: String?

    var body: some View {
        List {
            switch load {
            case .loading:
                Section { ProgressView().frame(maxWidth: .infinity) } footer: { description }
            case .ready(let status):
                statusSection(status)
            case .setup(let setup):
                setupSection(setup)
            case .codes(let codes):
                codesSection(codes)
            case .signInAgain:
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sign in again to turn on two-factor authentication.").foregroundStyle(Theme.heading)
                        Text("For your security, this needs a sign-in from the last 10 minutes.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 4)
                    Button("Sign out and sign in again", action: onSignOut)
                }
            case .failed(let message):
                Section {
                    Text("Couldn’t load two-factor authentication. \(message)").foregroundStyle(Theme.body)
                    Button("Retry") { Task { await refresh() } }
                }
            }
            if let actionError {
                Section { Text(actionError).font(.footnote).foregroundStyle(.red) }
            }
        }
        .listRowBackground(Theme.surface)
        .scrollContentBackground(.hidden)
        .background(Theme.canvas)
        .navigationTitle("Two-factor authentication")
        .navigationBarTitleDisplayMode(.inline)
        .task { await refresh() }
        .sheet(item: $confirming) { confirm in
            NavigationStack {
                VStack(alignment: .leading, spacing: 16) {
                    Text(confirm.text).foregroundStyle(Theme.body)
                    MfaCodeEntry(submitLabel: confirm.action) { code in
                        try await apply(confirm, code: code)
                    }
                    Spacer()
                }
                .padding(24)
                .navigationTitle(confirm.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { confirming = nil } } }
            }
            .presentationDetents([.medium])
        }
    }

    private var description: some View {
        Text("Ask for a code from an authenticator app each time you sign in, so a stolen password or email is not enough.")
    }

    private func statusSection(_ status: AccountAPI.MfaStatus) -> some View {
        Section {
            if status.enabled {
                LabeledContent("Status", value: String(localized: "On"))
                LabeledContent("Recovery codes left", value: "\(status.recoveryCodesRemaining)")
                Button("New recovery codes") { confirming = .codes }
                Button("Turn off", role: .destructive) { confirming = .disable }
                if let passkeys = status.passkeys {
                    ForEach(passkeys) { passkey in
                        HStack {
                            Label(passkey.name, systemImage: "person.badge.key")
                            Spacer()
                            Button("Remove", role: .destructive) { confirming = .removePasskey(passkey) }
                                .buttonStyle(.borderless)
                        }
                    }
                    Button {
                        Task { await addPasskey() }
                    } label: {
                        HStack { Text("Add a passkey"); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy)
                }
            } else {
                LabeledContent("Status", value: String(localized: "Off"))
                Button {
                    Task { await startSetup() }
                } label: {
                    HStack { Text("Turn on"); if busy { Spacer(); ProgressView() } }
                }
                .disabled(busy)
            }
        } footer: { description }
    }

    private func setupSection(_ setup: AccountAPI.MfaSetup) -> some View {
        Group {
            Section("1. Add Nuphos to your authenticator app") {
                if let url = URL(string: setup.otpauthUrl) {
                    // On a phone, the authenticator is usually on this same device.
                    Link("Open in authenticator app", destination: url)
                }
                if let qr = Self.qrCode(setup.otpauthUrl) {
                    Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                        .frame(width: 180, height: 180).frame(maxWidth: .infinity)
                        .accessibilityLabel("QR code for your authenticator app")
                }
                Text(setup.secret.chunked(4)).font(.body.monospaced()).textSelection(.enabled)
            }
            Section("2. Enter the 6-digit code it shows") {
                MfaCodeEntry(submitLabel: "Turn on") { code in
                    guard let token = session.token else { return }
                    load = .codes(try await AccountAPI.confirmMfaSetup(code: code, token: token))
                }
                .padding(.vertical, 8)
                Button("Cancel") { Task { await refresh() } }
            }
        }
    }

    private func codesSection(_ codes: [String]) -> some View {
        Section {
            ForEach(codes, id: \.self) { Text($0).font(.body.monospaced()).textSelection(.enabled) }
            Button("Copy codes") { UIPasteboard.general.string = codes.joined(separator: "\n") }
            Button("I saved them") { Task { await refresh() } }
        } header: {
            Text("Save your recovery codes")
        } footer: {
            Text("If you lose your authenticator, each code signs you in once. They are shown only now.")
        }
    }

    private func refresh() async {
        guard let token = session.token else { return }
        actionError = nil
        do {
            load = .ready(try await AccountAPI.mfaStatus(token: token))
        } catch NuphosAPI.Failure.sessionRequired {
            load = .signInAgain
        } catch is CancellationError {
        } catch {
            load = .failed(error.localizedDescription)
        }
    }

    private func startSetup() async {
        guard let token = session.token else { return }
        busy = true
        actionError = nil
        defer { busy = false }
        do {
            load = .setup(try await AccountAPI.startMfaSetup(token: token))
        } catch NuphosAPI.Failure.signInRequired {
            load = .signInAgain
        } catch NuphosAPI.Failure.sessionRequired {
            load = .signInAgain
        } catch {
            actionError = error.localizedDescription
        }
    }

    private func apply(_ confirm: Confirm, code: String) async throws {
        guard let token = session.token else { return }
        switch confirm {
        case .disable:
            try await AccountAPI.disableMfa(code: code, token: token)
            confirming = nil
            await refresh()
        case .codes:
            let codes = try await AccountAPI.newRecoveryCodes(code: code, token: token)
            confirming = nil
            load = .codes(codes)
        case .removePasskey(let passkey):
            try await AccountAPI.removePasskey(id: passkey.id, answer: code, token: token)
            confirming = nil
            await refresh()
        }
    }

    /// A passkey on this device, for signing in and confirming it's you. A
    /// session that has not entered a code lately is asked for one first.
    private func addPasskey() async {
        guard let token = session.token else { return }
        busy = true
        actionError = nil
        defer { busy = false }
        do {
            try await AccountAPI.addPasskey(name: UIDevice.current.name, token: token)
            await refresh()
        } catch Passkeys.Failure.cancelled {
        } catch {
            actionError = error.localizedDescription
        }
    }

    /// The otpauth:// link as a QR code, dark on white so any camera reads it.
    private static func qrCode(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        guard let image = filter.outputImage,
              let cgImage = CIContext().createCGImage(image, from: image.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

private extension String {
    /// "JBSWY3DP…" → "JBSW Y3DP …", easier to type by hand.
    func chunked(_ size: Int) -> String {
        stride(from: 0, to: count, by: size).map { offset -> String in
            let start = index(startIndex, offsetBy: offset)
            return String(self[start..<(index(start, offsetBy: size, limitedBy: endIndex) ?? endIndex)])
        }.joined(separator: " ")
    }
}
