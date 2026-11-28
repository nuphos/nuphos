import SwiftUI

struct AIConsentView: View {
    @Environment(AuthSession.self) private var session
    let user: NuphosUser
    var embedded = false
    var onContinue: (() -> Void)? = nil
    var previewAgree: (() -> Void)? = nil
    @State private var showAccount = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        if embedded { content } else { NavigationStack { content } }
    }

    private var content: some View {
        // Fits one screen: compact legal text above, the choice pinned below it.
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Image("AppIconPreview-\(AppIconPicker.current)").resizable().scaledToFit()
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                Text("Before you use AI agents", comment: "Legal text").font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
                    .padding(.bottom, 2)
                Text("Using an agent sends your prompts, conversation history, uploaded images and files, and relevant results from connected tools to the providers needed to carry out your request.", comment: "Legal text")
                Text("Who receives this data", comment: "Legal text").font(.footnote.weight(.semibold)).foregroundStyle(Theme.heading)
                    .padding(.top, 4)
                Text("Depending on your runtime and model, this includes Anthropic (Claude), OpenAI (Codex), xAI (Grok), Google (Antigravity), DeepSeek (DeepSeek Harness), the model provider an OpenCode runtime uses (OpenCode Zen when it is not signed in to one), or Amazon Web Services. When tracing is enabled, Nuphos stores AI execution traces, which can include conversation and tool content, for diagnostics and service improvement.", comment: "Legal text")
                Text("Your choice", comment: "Legal text").font(.footnote.weight(.semibold)).foregroundStyle(Theme.heading)
                    .padding(.top, 4)
                Text("Only share information you are authorized to share. You can decline and still manage your account or request its deletion. You can withdraw permission in Account → AI data sharing. Withdrawal stops new AI use from this app; it does not undo completed transfers or stop work already running, including work started on other devices or by scheduled agents.", comment: "Legal text")
                Link("Read the privacy policy", destination: URL(string: "https://nuphos.ai/privacy")!).foregroundStyle(Theme.link)
                if let error { Text(error).foregroundStyle(.red).accessibilityLabel(error) }
                if previewAgree == nil && session.aiConsentVersion == nil {
                    Button("Retry loading consent") { Task { await session.loadAIConsent() } }
                    if let message = session.aiConsentError { Text(message).foregroundStyle(.red) }
                }
            }
            .font(.footnote).foregroundStyle(Theme.body)
            .padding(.horizontal, 24).padding(.top, 4).padding(.bottom, 16)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 4) {
                if let onContinue, session.aiConsentAccepted {
                    Button(action: onContinue) { Text("Continue").frame(maxWidth: .infinity) }
                        .buttonStyle(DesignPrimaryButtonStyle())
                    Button("Manage AI data sharing") { showAccount = true }
                        .font(.subheadline.weight(.medium)).foregroundStyle(Theme.muted).frame(minHeight: 44)
                } else {
                    Button {
                        if let previewAgree {
                            previewAgree()
                            return
                        }
                        busy = true
                        Task {
                            do { try await session.setAIConsent(accepted: true) }
                            catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    } label: {
                        Text("Agree and continue").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(DesignPrimaryButtonStyle())
                    .disabled(busy || (previewAgree == nil && session.aiConsentVersion == nil))
                    Button("Not now — manage my account") { showAccount = true }
                        .font(.subheadline.weight(.medium)).foregroundStyle(Theme.muted).frame(minHeight: 44)
                        .disabled(busy)
                }
            }
            .padding(.horizontal, 24).padding(.top, 8)
            .frame(maxWidth: 620)
            .frame(maxWidth: .infinity)
            .background(Theme.canvas)
        }
        .background(Theme.canvas)
        .sheet(isPresented: $showAccount) { ProfileSheet(user: user) }
    }
}
