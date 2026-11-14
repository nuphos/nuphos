import SwiftUI

/// Parameters and result of one tool call — the "View details" FlowDown
/// opens from a tool row. Command tools get a terminal-style result.
struct ToolDetailSheet: View {
    let part: ChatPart.ToolPart
    let session: ChatSession
    @Environment(AgentStore.self) private var store
    @State private var choosingCredentials = false
    @State private var showingConnectors = false
    @Environment(\.dismiss) private var dismiss

    private var isCommand: Bool { part.isCommandTool }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    if part.isProviderIntegrationRequest { integrationActions }

                    if isCommand, let command = part.input?["command"]?.stringValue {
                        section("Command") { code(command) }
                        if let out = part.output {
                            let stdout = out["stdout"]?.stringValue ?? ""
                            let stderr = out["stderr"]?.stringValue ?? ""
                            let exit = out["exitCode"]?.numberValue.map { Int($0) }
                            if !stdout.isEmpty { section("Output") { code(stdout) } }
                            if !stderr.isEmpty { section("Errors") { code(stderr, tint: .red) } }
                            if let exit { section("Exit code") { Text("\(exit)").font(Theme.Text.mono(.footnote)) } }
                            if stdout.isEmpty, stderr.isEmpty, exit == nil { section("Result") { code(out.prettyPrinted) } }
                        }
                    } else {
                        if let input = part.input { section("Parameters") { code(input.prettyPrinted) } }
                        if let output = part.output { section("Result") { code(output.prettyPrinted) } }
                    }
                    if let error = part.errorText { section("Error") { code(error, tint: .red) } }
                }
                .padding(16)
            }
            .background(Theme.chatCanvas)
            .navigationTitle(part.kindLabel)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .sheet(isPresented: $choosingCredentials) {
            CredentialPickerSheet(selection: Binding(
                get: { session.credentialAccess ?? CredentialSelection() },
                set: { session.setCredentials($0) }))
        }
        .sheet(isPresented: $showingConnectors) {
            NavigationStack {
                ConnectorsPage()
                    .navigationTitle("Connectors")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { showingConnectors = false } }
                    }
            }
        }
        .tint(Theme.heading)
    }

    private var integrationActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(part.input?["question"]?.stringValue ?? "")
                .font(Theme.Text.body)
                .foregroundStyle(Theme.heading)
            if session.ownsChat {
                Button("Choose credentials") { choosingCredentials = true }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("integration.chooseCredentials")
                Text("Choose a connected account to use here.")
                    .font(Theme.Text.caption)
                    .foregroundStyle(Theme.muted)
            } else {
                Text("The owner can choose credentials here.")
                    .font(Theme.Text.caption)
                    .foregroundStyle(Theme.muted)
            }
            Button("Open Connectors") { showingConnectors = true }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("integration.openConnectors")
            Text(store.selectedTeam?.isAdministrator == true
                 ? "Account not connected yet? Add it in Connectors, then return here and choose it."
                 : "Account not connected yet? Ask a team administrator to add it in Connectors, then return here and choose it.")
                .font(Theme.Text.caption)
                .foregroundStyle(Theme.muted)
            if let error = session.error {
                Text(error).font(Theme.Text.caption).foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(part.displayLabel).font(Theme.Text.body.weight(.semibold)).foregroundStyle(Theme.heading)
            Text("\(part.kindLabel) · \(part.state.rawValue.replacingOccurrences(of: "-", with: " "))").font(Theme.Text.caption).foregroundStyle(Theme.muted)
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(Theme.Text.micro.weight(.semibold)).kerning(0.4).foregroundStyle(Theme.muted)
            content()
        }
    }

    private func code(_ text: String, tint: Color? = nil) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(text)
                .font(Theme.Text.mono(.caption))
                .foregroundStyle(tint ?? Theme.heading)
                .textSelection(.enabled)
                .padding(12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
