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
                    Image(systemName: "hand.raised.fill").font(.largeTitle).foregroundStyle(Theme.brand)
                    Text("Before you use AI agents").font(.title.bold())
                    Text("Using an agent sends your prompts, conversation history, uploaded images and files, and relevant results from connected tools to the providers needed to carry out your request.")
                    Text("Who receives this data").font(.headline)
                    Text("Depending on your agent and model, this includes Anthropic (Claude), OpenAI (Codex), xAI (Grok), Google (Antigravity), or Amazon Web Services. When tracing is enabled, Nuphos stores AI execution traces, which can include conversation and tool content, for diagnostics and service improvement.")
                    Text("Your choice").font(.headline)
                    Text("Only share information you are authorized to share. You can decline and still manage your account or request its deletion. You can withdraw permission in Account → AI data sharing. Withdrawal stops new AI use from this app; it does not undo completed transfers or stop work already running, including work started on other devices or by scheduled agents.")
                    Link("Read the privacy policy", destination: URL(string: "https://nuphos.ai/privacy")!)
                    if let error { Text(error).foregroundStyle(.red).accessibilityLabel(error) }
                    Button("Agree and continue") {
                        busy = true
                        Task {
                            do { try await session.setAIConsent(accepted: true) }
                            catch { self.error = error.localizedDescription }
                            busy = false
                        }
                    }
                    .buttonStyle(.borderedProminent).disabled(busy || session.aiConsentVersion == nil)
                    Button("Not now — manage my account") { showAccount = true }.disabled(busy)
                    if session.aiConsentVersion == nil {
                        Button("Retry loading consent") { Task { await session.loadAIConsent() } }
                        if let message = session.aiConsentError { Text(message).foregroundStyle(.red) }
                    }
                }
                .padding(24).frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.canvas)
            .sheet(isPresented: $showAccount) { ProfileSheet(user: user) }
        }
    }
}
