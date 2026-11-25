import PhotosUI
import SwiftUI

/// Account and app preferences behind the home avatar. Account options own
/// profile editing and sign-out; workspace switching stays in the toolbar.
struct ProfileSheet: View {
    @Environment(AuthSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    /// Absent when shown before sign-in finishes (the AI consent screen).
    @Environment(AgentStore.self) private var store: AgentStore?
    let user: NuphosUser
    /// Back to two-factor setup after the sign-in it asked for.
    var openTwoFactor = false
    private var currentUser: NuphosUser { session.user ?? user }
    @AppStorage(BotAvatars.enabledKey, store: BotAvatars.defaults) private var botAvatars = true
    @AppStorage(Analytics.sendUsageDataKey) private var sendUsageData = true

    @State private var editing = false
    @State private var showAppIcons = false
    @State private var showTwoFactor = false
    @State private var privacyError: String?
    @AppStorage(Whisper.promptKey) private var whisperPrompt = Whisper.defaultPrompt

    private var twoFactor: some View {
        TwoFactorView {
            TwoFactorView.resumeAfterSignIn()
            dismiss()
            session.signOut()
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Signed-in accounts") {
                    SavedAccountsView(allowAdding: true, editProfile: { editing = true })
                }
                .listRowBackground(Theme.surface)

                if store != nil {
                    Section("Integrations") {
                        NavigationLink {
                            ConnectorsPage().navigationTitle("Connectors")
                        } label: {
                            Label { Text("Connectors") } icon: { LucideIcon("blocks") }
                        }
                    }
                    .listRowBackground(Theme.surface)
                }

                Section("Account") {
                    NavigationLink("Signed-in devices") {
                        SignedInDevicesView {
                            dismiss()
                            session.signOut()
                        }
                    }
                    NavigationLink("Two-factor authentication") { twoFactor }
                }
                .listRowBackground(Theme.surface)

                #if os(iOS)
                Section {
                    TextField("Transcription prompt", text: $whisperPrompt, axis: .vertical)
                        .lineLimit(2...6)
                        .accessibilityIdentifier("voice.prompt")
                    if whisperPrompt != Whisper.defaultPrompt {
                        Button("Reset prompt") { whisperPrompt = Whisper.defaultPrompt }
                    }
                } header: {
                    Text("Voice input")
                } footer: {
                    Text("The prompt sets the writing style and spells names Whisper doesn't know, such as products and services. Voice input is included with a Nuphos subscription; recordings are transcribed by OpenAI Whisper.", comment: "Legal text")
                }
                .listRowBackground(Theme.surface)
                #endif

                Section {
                    NavigationLink("Computer notifications") {
                        ComputerNotificationsView()
                    }
                } header: {
                    Text("Notifications")
                } footer: {
                    Text("Off by default. Choose which computers you want to hear about.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Toggle("Bot avatars", isOn: $botAvatars)
                    #if os(iOS)
                    NavigationLink("App icon") { AppIconPicker() }
                    #endif
                } header: {
                    Text("Appearance")
                } footer: {
                    Text("Give Bots a character avatar. Turn off to show Runtime icons.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Toggle("Send usage data", isOn: $sendUsageData)
                        .accessibilityIdentifier("privacy.usageData")
                        .onChange(of: sendUsageData) { _, on in
                            Analytics.shared.setSendUsageData(on, user: session.user)
                        }
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
                    if let privacyError { Text(privacyError).foregroundStyle(.red) }
                } header: {
                    Text("Privacy")
                } footer: {
                    Text("Usage data shows Nuphos which features are used, never what you write. It is sent only while you use Nuphos Cloud. This setting is saved on this device.")
                }
                .listRowBackground(Theme.surface)

                Section("Danger zone") {
                    NavigationLink {
                        AccountDeletionView(user: currentUser)
                    } label: {
                        Label { Text("Delete account") } icon: { LucideIcon("trash-2") }
                            .foregroundStyle(.red)
                    }
                }
                .listRowBackground(Theme.surface)

                Section {
                    VStack(spacing: 6) {
                        Image("NuphosMark").resizable().scaledToFit()
                            .frame(width: 36, height: 36)
                            .accessibilityLabel("Nuphos logo")
                        Text("Nuphos").font(.headline)
                        Text(verbatim: versionLabel)
                            .font(.caption)
                            .accessibilityIdentifier("account.version")
                    }
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }
            }
            .listRowSeparator(.hidden)
        .scrollContentBackground(.hidden)
            .background(Theme.canvas)
            #if os(iOS)
            .navigationDestination(isPresented: $showAppIcons) { AppIconPicker() }
            #endif
            #if DEBUG
            .onAppear { if ProcessInfo.processInfo.arguments.contains("-show-app-icons") { showAppIcons = true } }
            #endif
            .navigationDestination(isPresented: $showTwoFactor) { twoFactor }
            .onAppear { if openTwoFactor { showTwoFactor = true } }
            .sheet(isPresented: $editing) { EditProfileSheet(user: currentUser) }
            .refreshable { await session.refreshUser() }
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: { LucideIcon("x") }
                        .accessibilityLabel("Close account")
                }
            }

        }
        .tint(Theme.heading)
    }

    private var versionLabel: String {
        let info = Bundle.main.infoDictionary ?? [:]
        let version = info["CFBundleShortVersionString"] as? String ?? "—"
        let build = info["CFBundleVersion"] as? String ?? "—"
        #if DEBUG
        return "\(version) (\(build)) · Local"
        #else
        return "\(version) (\(build))"
        #endif
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
                            error = String(localized: "This image could not be read.")
                            return
                        }
                        setAvatar(image)
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.canvas)
            .disabled(saving)
            .navigationTitle("Edit profile")
            .navigationBarTitleDisplayMode(.inline)
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
