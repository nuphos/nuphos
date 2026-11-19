import SwiftUI

struct AIConsentView: View {
    @Environment(AuthSession.self) private var session
    let user: NuphosUser
    @State private var showAccount = false
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Image("NuphosMark").resizable().scaledToFit().frame(width: 36, height: 36).accessibilityHidden(true)
                    Text("Before you use AI agents", comment: "Legal text").font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
                    Text("Using an agent sends your prompts, conversation history, uploaded images and files, and relevant results from connected tools to the providers needed to carry out your request.", comment: "Legal text")
                    Text("Who receives this data", comment: "Legal text").font(.callout.weight(.semibold))
                    Text("Depending on your runtime and model, this includes Anthropic (Claude), OpenAI (Codex), xAI (Grok), Google (Antigravity), DeepSeek (DeepSeek Harness), the model provider an OpenCode runtime uses (OpenCode Zen when it is not signed in to one), or Amazon Web Services. When tracing is enabled, Nuphos stores AI execution traces, which can include conversation and tool content, for diagnostics and service improvement.", comment: "Legal text")
                    Text("Your choice", comment: "Legal text").font(.callout.weight(.semibold))
                    Text("Only share information you are authorized to share. You can decline and still manage your account or request its deletion. You can withdraw permission in Account → AI data sharing. Withdrawal stops new AI use from this app; it does not undo completed transfers or stop work already running, including work started on other devices or by scheduled agents.", comment: "Legal text")
                    Link("Read the privacy policy", destination: URL(string: "https://nuphos.ai/privacy")!).foregroundStyle(Theme.link)
                    if let error { Text(error).foregroundStyle(.red).accessibilityLabel(error) }
                    Button("Agree and continue") {
                        busy = true
                        Task {
                            do { try await session.setAIConsent(accepted: true) }
                            catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    }
                    .frame(maxWidth: .infinity).prominentButton().disabled(busy || session.aiConsentVersion == nil)
                    Button("Not now — manage my account") { showAccount = true }.font(.callout).foregroundStyle(Theme.body).frame(minHeight: 44).disabled(busy)
                    if session.aiConsentVersion == nil {
                        Button("Retry loading consent") { Task { await session.loadAIConsent() } }
                        if let message = session.aiConsentError { Text(message).foregroundStyle(.red) }
                    }
                }
                .font(.callout).foregroundStyle(Theme.body)
                .padding(24).frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.canvas)
            .sheet(isPresented: $showAccount) { ProfileSheet(user: user) }
        }
    }
}
