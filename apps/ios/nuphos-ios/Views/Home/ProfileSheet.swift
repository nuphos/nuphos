import SwiftUI

/// The account sheet behind the avatar in the home toolbar: the user record
/// from `/auth/me`, field by field, with a way out.
struct ProfileSheet: View {
    @Environment(AuthSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let user: NuphosUser
    private var currentUser: NuphosUser { session.user ?? user }
    @State private var editing = false

    @State private var confirmSignOut = false
    @State private var privacyError: String?
    @State private var hasOpenAIKey = Keychain.read(Whisper.keychainKey) != nil
    @AppStorage(Whisper.promptKey) private var whisperPrompt = Whisper.defaultPrompt

    var body: some View {
        NavigationStack {
            List {
                Section {
                    header
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 16, trailing: 0))
                }

                Section("Account") {
                    Button("Edit profile") { editing = true }
                    InfoRow(label: "Name", value: currentUser.name)
                    InfoRow(label: "Username", value: currentUser.username, monospaced: true)
                    InfoRow(label: "Email", value: currentUser.email)
                    InfoRow(label: "User ID", value: currentUser.id, monospaced: true)
                    InfoRow(label: "Avatar URL", value: currentUser.avatarURL, monospaced: true)
                }
                .listRowBackground(Theme.surface)

                #if os(iOS)
                Section {
                    if hasOpenAIKey {
                        Text("OpenAI API key saved on this device")
                        Button("Remove OpenAI API key", role: .destructive) {
                            Keychain.delete(Whisper.keychainKey)
                            hasOpenAIKey = false
                        }
                    } else {
                        Text("Tap the microphone in the composer to add your OpenAI API key.")
                    }
                    TextField("Transcription prompt", text: $whisperPrompt, axis: .vertical)
                        .lineLimit(2...6)
                    if whisperPrompt != Whisper.defaultPrompt {
                        Button("Reset prompt") { whisperPrompt = Whisper.defaultPrompt }
                    }
                } header: {
                    Text("Voice input")
                } footer: {
                    Text("The prompt sets the writing style and spells names Whisper doesn't know, such as products and services. Recordings are transcribed by OpenAI Whisper with your own key and billed to your OpenAI account.")
                }
                .listRowBackground(Theme.surface)
                #endif

                Section("Privacy") {
                    Link("Privacy policy", destination: URL(string: "https://nuphos.ai/privacy")!)
                    if session.aiConsentAccepted {
                        Button("Withdraw AI data sharing permission") {
                            Task {
                                do { try await session.setAIConsent(accepted: false); dismiss() }
                                catch { privacyError = error.localizedDescription }
                            }
                        }
                    } else {
                        Text("AI data sharing is off. Close Account to read the notice.")
                    }
                    NavigationLink("Delete account") { AccountDeletionView(user: user) }
                    if let privacyError { Text(privacyError).foregroundStyle(.red) }
                }
                .listRowBackground(Theme.surface)

                Section {
                    Button(role: .destructive) {
                        confirmSignOut = true
                    } label: {
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.canvas)
            .sheet(isPresented: $editing) { EditProfileSheet(user: currentUser) }
            .refreshable { await session.refreshUser() }
            .navigationTitle("Account")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .confirmationDialog("Sign out of Nuphos?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    session.signOut()
                }
                Button("Cancel", role: .cancel) {}
            }
        }
        .tint(Theme.heading)
    }

    private var header: some View {
        VStack(spacing: 14) {
            AvatarView(user: currentUser, size: 84)
            VStack(spacing: 4) {
                Text(currentUser.displayName)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Theme.heading)
                if !currentUser.username.isEmpty {
                    Text("@\(currentUser.username)")
                        .font(.system(size: 14, weight: .medium, design: .monospaced))
                        .foregroundStyle(Theme.brandText)
                }
                Text(currentUser.email)
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.body)
            }
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }
}

private struct InfoRow: View {
    let label: String
    let value: String
    var monospaced = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Theme.muted)
                .textCase(.uppercase)
                .kerning(0.4)
            Text(value.isEmpty ? "—" : value)
                .font(monospaced ? .system(size: 14, design: .monospaced) : .system(size: 15))
                .foregroundStyle(value.isEmpty ? Theme.muted : Theme.heading)
                .textSelection(.enabled)
                .lineLimit(3)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    ProfileSheet(user: .preview).environment(AuthSession())
}


private struct EditProfileSheet: View {
    @Environment(AuthSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var username: String
    @State private var avatar: String
    @State private var saving = false
    @State private var error: String?

    init(user: NuphosUser) {
        _name = State(initialValue: user.name)
        _username = State(initialValue: user.username)
        _avatar = State(initialValue: user.avatarURL)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Name", text: $name).textContentType(.name)
                    TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section {
                    TextField("Google profile image URL (optional)", text: $avatar)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } footer: {
                    Text("Use an existing Google profile image URL, or leave this empty for your initials.")
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .disabled(saving)
            .navigationTitle("Edit profile")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : "Save") {
                        saving = true
                        Task {
                            defer { saving = false }
                            do {
                                try await session.updateProfile(name: name.trimmingCharacters(in: .whitespacesAndNewlines), username: username.trimmingCharacters(in: .whitespacesAndNewlines), avatarURL: avatar.trimmingCharacters(in: .whitespacesAndNewlines))
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || username.isEmpty || name.count > 100 || username.count > 40)
                }
            }
        }
    }
}
