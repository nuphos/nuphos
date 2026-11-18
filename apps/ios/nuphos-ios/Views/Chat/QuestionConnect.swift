import SwiftUI

/// An integration question's "Choose credentials", the same in the Inbox and a Bot's chat: the
/// member's own credentials are added as named, with no picker; otherwise the asking conversation's
/// picker opens on its own selection, offering only the providers the question asks for. Closing
/// it saves the selection; the server answers the question it covers, and the card says why if not.
struct QuestionConnect: View {
    @Environment(AgentStore.self) private var store
    let questions: OpenQuestions
    let question: BotQuestion
    let wide: Bool

    /// The picker shows, on the asking conversation's selection as edited there.
    @State private var connecting = false
    @State private var selection = CredentialSelection()

    var body: some View {
        InboxOption(title: label, wide: wide, fill: !wide, primary: true) { Task { await connect() } }
            .sheet(isPresented: $connecting, onDismiss: save) {
                CredentialPickerSheet(selection: $selection, providers: question.request.providers).presentationDetents([.medium, .large])
            }
    }

    /// "Use your own GitHub" for a question naming the member's own credential; otherwise the picker.
    private var label: String {
        guard let own = question.personalCredentials else { return String(localized: "Choose credentials") }
        let names = own.map { $0 == "github" ? "GitHub" : $0 == "linear" ? "Linear" : $0 }
        return String(localized: "Use your own \(names.joined(separator: " and "))")
    }

    private func connect() async {
        if let own = question.personalCredentials {
            await store.loadCredentialOptions()
            let connected = store.credentialCatalog.map { catalog in
                Set(catalog.allItems.filter { $0.provider.selectionKey == "personalCredentialIds" }.map(\.id))
            }
            await questions.useOwn(own, for: question, connected: connected)
            return
        }
        guard let current = await questions.storedSelection(for: question) else { return }
        selection = current
        connecting = true
    }

    private func save() {
        let chosen = selection
        let question = question
        Task { await questions.select(chosen, for: question) }
    }
}
