import SwiftUI

/// Account → Signed-in devices: where the account is signed in, with a way to
/// end any other sign-in. Matches Desktop's `SignedInDevicesSection`.
struct SignedInDevicesView: View {
    @Environment(AuthSession.self) private var session
    /// Signs out so the user can sign back in with a session.
    let onSignOut: () -> Void

    private enum Load: Equatable {
        case loading
        case ready([SignInSession])
        /// A sign-in from before sessions: it works, but has no session to manage from.
        case signInAgain
        case failed(String)
    }

    private enum Target: Equatable {
        case one(SignInSession)
        case others
    }

    @State private var load = Load.loading
    @State private var busy = false
    @State private var confirming: Target?
    @State private var actionError: String?

    private var sessions: [SignInSession] {
        if case .ready(let sessions) = load { return sessions }
        return []
    }

    var body: some View {
        List {
            switch load {
            case .loading:
                Section { ProgressView().frame(maxWidth: .infinity) } footer: { description }
                    .listRowBackground(Theme.surface)
            case .signInAgain:
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Sign in again to manage your devices.").foregroundStyle(Theme.heading)
                        Text("This device signed in before device management existed.")
                            .font(.footnote).foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 4)
                    Button("Sign out and sign in again", action: onSignOut)
                } footer: { description }
                .listRowBackground(Theme.surface)
            case .failed(let message):
                Section {
                    Text("Couldn’t load your signed-in devices. \(message)").foregroundStyle(Theme.body)
                    Button("Retry") { Task { await refresh() } }
                }
                .listRowBackground(Theme.surface)
            case .ready(let sessions):
                Section {
                    ForEach(sessions) { row($0) }
                } footer: { description }
                .listRowBackground(Theme.surface)
                if sessions.contains(where: { !$0.isCurrent }) {
                    Section {
                        Button("Sign out all other devices", role: .destructive) { confirming = .others }
                            .disabled(busy)
                    } footer: {
                        if let actionError { Text(actionError).foregroundStyle(.red) }
                    }
                    .listRowBackground(Theme.surface)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.canvas)
        .navigationTitle("Signed-in devices")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await refresh() }
        .refreshable { await refresh() }
        .confirmationDialog(confirmTitle, isPresented: confirmingShown, titleVisibility: .visible, presenting: confirming) { target in
            Button("Sign out", role: .destructive) { Task { await signOut(target) } }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text(target == .others ? "Every device except this one will need to sign in again." : "That device will need to sign in again.")
        }
    }

    private var description: some View {
        Text("Where your account is signed in. Sign out anything you don’t recognize, then change your password.")
    }

    private func row(_ device: SignInSession) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(SignInSessions.device(device))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Theme.heading)
                        .lineLimit(1)
                    if device.isCurrent {
                        Text("This device")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Theme.brandText)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Theme.brand.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
                            .fixedSize()
                    }
                }
                Text("\(SignInSessions.place(device)) · \(SignInSessions.activity(device))")
                    .font(.system(size: 13))
                    .foregroundStyle(Theme.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            if !device.isCurrent {
                Button("Sign out") { confirming = .one(device) }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(busy)
            }
        }
        .padding(.vertical, 2)
    }

    private var confirmTitle: String {
        switch confirming {
        case .one(let device): "Sign out \(SignInSessions.device(device))?"
        case .others: "Sign out all other devices?"
        case nil: ""
        }
    }

    private var confirmingShown: Binding<Bool> {
        Binding { confirming != nil } set: { if !$0 { confirming = nil } }
    }

    private func refresh() async {
        guard let token = session.token else { return }
        do {
            load = .ready(SignInSessions.sorted(try await AccountAPI.signInSessions(token: token)))
        } catch NuphosAPI.Failure.sessionRequired {
            load = .signInAgain
        } catch is CancellationError {
        } catch {
            load = .failed(error.localizedDescription)
        }
    }

    private func signOut(_ target: Target) async {
        guard let token = session.token else { return }
        busy = true
        actionError = nil
        defer { busy = false }
        do {
            switch target {
            case .one(let device): try await AccountAPI.signOutSession(id: device.id, token: token)
            case .others: _ = try await AccountAPI.signOutOtherSessions(token: token)
            }
        } catch {
            actionError = "Could not sign out. \(error.localizedDescription)"
        }
        await refresh()
    }
}
