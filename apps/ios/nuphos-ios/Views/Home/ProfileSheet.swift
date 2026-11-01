import PhotosUI
import SwiftUI

/// The account sheet behind the avatar in the home toolbar: the user record
/// from `/auth/me`, field by field, with a way out.
struct ProfileSheet: View {
    @Environment(AuthSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    let user: NuphosUser
    private var currentUser: NuphosUser { session.user ?? user }
    @State private var editing = false
    @AppStorage(BotAvatars.enabledKey, store: BotAvatars.defaults) private var botAvatars = true

    @State private var confirmSignOut = false
    @State private var showAppIcons = false
    @State private var privacyError: String?
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
                    NavigationLink("Signed-in devices") {
                        SignedInDevicesView {
                            dismiss()
                            session.signOut()
                        }
                    }
                }
                .listRowBackground(Theme.surface)

                #if os(iOS)
                Section {
                    TextField("Transcription prompt", text: $whisperPrompt, axis: .vertical)
                        .lineLimit(2...6)
                    if whisperPrompt != Whisper.defaultPrompt {
                        Button("Reset prompt") { whisperPrompt = Whisper.defaultPrompt }
                    }
                } header: {
                    Text("Voice input")
                } footer: {
                    Text("The prompt sets the writing style and spells names Whisper doesn't know, such as products and services. Voice input is included with a Nuphos subscription; recordings are transcribed by OpenAI Whisper.")
                }
                .listRowBackground(Theme.surface)
                #endif

                Section {
                    Toggle("Bot avatars", isOn: $botAvatars)
                    #if os(iOS)
                    NavigationLink("App icon") { AppIconPicker() }
                    #endif
                } header: {
                    Text("Appearance")
                } footer: {
                    Text("Give Agents a character avatar. Turn off to show Runtime icons.")
                }
                .listRowBackground(Theme.surface)

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
            #if os(iOS)
            .navigationDestination(isPresented: $showAppIcons) { AppIconPicker() }
            #endif
            #if DEBUG
            .onAppear { if ProcessInfo.processInfo.arguments.contains("-show-app-icons") { showAppIcons = true } }
            #endif
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
    @State private var photo: PhotosPickerItem?
    @State private var saving = false
    @State private var error: String?
    private let user: NuphosUser
    private var currentUser: NuphosUser { session.user ?? user }

    init(user: NuphosUser) {
        self.user = user
        _name = State(initialValue: user.name)
        _username = State(initialValue: user.username)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Profile") {
                    TextField("Name", text: $name).textContentType(.name)
                    TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                Section {
                    HStack(spacing: 14) {
                        AvatarView(user: currentUser, size: 56)
                        PhotosPicker(currentUser.avatarURL.isEmpty ? "Choose photo" : "Change photo", selection: $photo, matching: .images)
                    }
                    if !currentUser.avatarURL.isEmpty {
                        Button("Remove photo", role: .destructive) { setAvatar(nil) }
                    }
                } footer: {
                    Text("Without a photo, your initials are shown.")
                }
                .onChange(of: photo) { _, item in
                    guard let item else { return }
                    photo = nil
                    Task {
                        guard let data = try? await item.loadTransferable(type: Data.self),
                              let image = ImageAttachment.avatar(from: data) else {
                            error = "This image could not be read."
                            return
                        }
                        setAvatar(image)
                    }
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
                                try await session.updateProfile(name: name.trimmingCharacters(in: .whitespacesAndNewlines), username: username.trimmingCharacters(in: .whitespacesAndNewlines), avatarURL: currentUser.avatarURL)
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }
                    }.disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || username.isEmpty || name.count > 100 || username.count > 40)
                }
            }
        }
    }

    private func setAvatar(_ image: Data?) {
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do { try await session.setAvatar(image) } catch { self.error = error.localizedDescription }
        }
    }
}
