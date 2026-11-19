import SwiftUI

struct RuntimeSetupGuide: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AgentStore.self) private var store
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Connect a computer").font(.title3.weight(.semibold)).foregroundStyle(Theme.heading)
                    Text("Your Bots and tasks need a runtime to work. Connect your computer with Nuphos Desktop, or ask a workspace administrator to share a runtime.").font(.callout).foregroundStyle(Theme.body)
                    // Desktop's Add computer offers a Box first, on the same flags.
                    if store.canCreateBox {
                        NavigationLink { NewBoxView() } label: {
                            HStack(alignment: .top, spacing: 12) {
                                LucideIcon("box").foregroundStyle(Theme.body).padding(.top, 2)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Nuphos computer").font(.callout.weight(.medium)).foregroundStyle(Theme.heading)
                                    Text("A Linux computer Nuphos runs for you, with Claude Code, Codex, OpenCode and other agents. Sign in with your own account.")
                                        .font(.footnote).foregroundStyle(Theme.body).multilineTextAlignment(.leading)
                                }
                                Spacer(minLength: 0)
                                LucideIcon("chevron-right").foregroundStyle(Theme.muted).padding(.top, 2)
                            }
                            .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("new-box")
                    } else if store.agentDevicesError {
                        // Without the list there is no knowing whether a Box is on offer: say so, as Desktop does (#3953).
                        HStack(spacing: 12) {
                            Text("Could not load computers.").font(.footnote).foregroundStyle(Theme.body)
                            Spacer(minLength: 0)
                            Button("Try again") { Task { await store.loadAgentDevices() } }
                                .font(.footnote.weight(.medium)).foregroundStyle(Theme.heading)
                        }
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                    } else if store.boxAvailable {
                        // A member: only administrators rent one, as Desktop says.
                        Text("Administrators rent computers from Nuphos.").font(.footnote).foregroundStyle(Theme.body)
                    }
                    VStack(alignment: .leading, spacing: 16) {
                        Text("1. Open Nuphos on your computer.")
                        Text("2. Sign in and choose this workspace.")
                        Text("3. Connect your computer and add a runtime.")
                    }.font(.callout).foregroundStyle(Theme.body).padding(20).frame(maxWidth: .infinity, alignment: .leading).background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
                    Link("Visit Nuphos", destination: URL(string: "https://nuphos.ai")!).prominentButton()
                }.padding(24)
            }.background(Theme.canvas)
            .navigationTitle("Runtime setup").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button { dismiss() } label: { LucideIcon("x") }.accessibilityLabel("Close") } }
        }
        // Opened from Home too, where the device list may not be loaded yet.
        .task(id: store.selectedTeam?.id) { await store.loadAgentDevices() }
    }
}
