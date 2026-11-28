import SwiftUI

/// A group chat's members, opened from its title as Desktop's member list is:
/// its Bots, each with whether it can reply now, its people, and leaving it.
/// Anyone adds their own Bots; only the owner adds or removes people.
struct ChannelMembersSheet: View {
    let channel: ChannelSession
    /// After leaving: the chat is no longer the viewer's to show.
    let onLeft: () -> Void

    @Environment(AgentStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private enum Page: Hashable { case addBot, addPeople }
    @State private var path: [Page] = []
    @State private var access: SessionAccess?
    @State private var loadError: String?
    @State private var members: [TeamMember]?
    @State private var membersError: String?
    @State private var search = ""
    /// What a request is changing: `leave`, or a person's or Bot's id.
    @State private var pending: String?
    @State private var confirmLeave = false
    @State private var failure: Failure?
    /// An invite refused until it also gives this person use of the chat's computer.
    @State private var needsComputer: (id: String, name: String)?

    private struct Failure { let title: LocalizedStringKey; let message: String }

    private var viewerId: String? { channel.viewerId }
    private var isOwner: Bool { access?.participants.first(where: \.isOwner)?.id == viewerId }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section("Bots") {
                    ForEach(channel.agents) { agent in
                        botRow(agent)
                            .swipeActions {
                                if isOwner || agent.ownerId == viewerId {
                                    Button("Remove", role: .destructive) {
                                        run(agent.sessionId, "Couldn’t remove the Bot") { try await channel.removeAgent(agent.sessionId) }
                                    }
                                }
                            }
                    }
                    actionRow("Add Bot", image: "bot-plus", id: "channel.addBot") { path.append(.addBot) }
                }
                peopleSection
                Section {
                    Button(role: .destructive) { confirmLeave = true } label: {
                        Label { Text("Leave chat") } icon: { Image("lucide-log-out").renderingMode(.template) }
                            .foregroundStyle(Theme.attention)
                    }
                    .disabled(access == nil || pending != nil)
                    .accessibilityIdentifier("channel.leave")
                }
            }
            .navigationTitle("Members")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .navigationDestination(for: Page.self) { page in
                switch page {
                case .addBot: addBotPage
                case .addPeople: addPeoplePage
                }
            }
        }
        .presentationDragIndicator(.visible)
        // On the sheet, not the List or a row, so an iPhone shows it from the bottom.
        .confirmationDialog(Text("Leave “\(channel.title)”?"), isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave chat", role: .destructive, action: leave)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(leaveMessage)
        }
        .alert(failure?.title ?? "", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK") {}
        } message: {
            Text(failure?.message ?? "")
        }
        .computerUseConfirmation($needsComputer, message: "Adding this person to the chat also gives them use of this computer. Continue?") {
            invite($0, grantComputerUse: true)
        }
        .task {
            do { access = try await channel.access("GET") } catch { if !Task.isCancelled { loadError = error.localizedDescription } }
        }
    }

    // MARK: - Members

    private func botRow(_ agent: ChannelAgent) -> some View {
        HStack(spacing: 10) {
            AgentAvatar(agentId: agent.sessionId, runtime: agent.provider, size: 28)
            Text(agent.title).foregroundStyle(Theme.heading).lineLimit(1)
            Spacer()
            if pending == agent.sessionId { ProgressView() } else if let presence = agent.presence { PresenceTag(presence: presence) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("channel.bot.\(agent.sessionId)")
    }

    private var peopleSection: some View {
        Section {
            if let shown = access {
                ForEach(shown.participants) { person in
                    HStack(spacing: 10) {
                        AvatarView(user: person.user, size: 28)
                            .opacity(person.deactivated == true ? 0.5 : 1)
                        Text(person.id == viewerId ? "\(person.user.displayName) (you)" : person.user.displayName)
                            .foregroundStyle(Theme.heading).lineLimit(1)
                        Spacer()
                        if pending == person.id { ProgressView() } else if person.isOwner { Text("Owner").foregroundStyle(Theme.muted) }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("channel.person.\(person.id)")
                    .swipeActions {
                        if isOwner, !person.isOwner {
                            Button("Remove", role: .destructive) {
                                run(person.id, "Couldn’t remove this person") {
                                    access = try await channel.access("DELETE", "participants/\(person.id)")
                                }
                            }
                        }
                    }
                }
                if isOwner { actionRow("Add people", image: "lucide-user-plus", id: "channel.addPeople") { path.append(.addPeople) } }
            } else if let loadError {
                Text(loadError).foregroundStyle(Theme.muted)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        } header: {
            Text("People")
        } footer: {
            if access != nil, !isOwner { Text("Only the owner can add people.") }
        }
    }

    private func actionRow(_ title: LocalizedStringKey, image: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label { Text(title) } icon: { Image(image).renderingMode(.template) }
                .foregroundStyle(Theme.link)
        }
        .accessibilityIdentifier(id)
    }

    // MARK: - Adding

    private var addBotPage: some View {
        List {
            Section {
                ForEach(store.bots.addable(to: channel.agents)) { bot in
                    Button {
                        run(bot.sessionId, "Couldn’t add the Bot") { try await channel.addAgent(bot.sessionId) }
                    } label: {
                        HStack(spacing: 10) {
                            AgentAvatar(agentId: bot.sessionId, runtime: bot.agentRuntime, size: 28)
                            Text(bot.displayTitle).foregroundStyle(Theme.heading).lineLimit(1)
                            Spacer()
                            if let presence = bot.presence, presence.tag.tone != .ready { PresenceTag(presence: presence) }
                            if pending == bot.sessionId { ProgressView() } else { LucideIcon("circle-plus").foregroundStyle(Theme.brandText) }
                        }
                    }
                    .disabled(pending != nil)
                    .accessibilityIdentifier("channel.addBot.\(bot.sessionId)")
                }
            } header: {
                Text("Your Bots")
            } footer: {
                Text("Adding your Bot lets everyone here talk to it. Anything that needs approval still waits for you in its own chat.")
            }
        }
        .navigationTitle("Add Bot")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// The Share sheet's invite list, for the people of this chat's team.
    private var addPeoplePage: some View {
        List {
            Section {
                if let membersError {
                    Text(membersError).foregroundStyle(Theme.muted)
                } else if let members {
                    InviteRows(members: members, joined: Set((access?.participants ?? []).map(\.id)), search: search, pending: pending) {
                        invite($0.id, name: $0.displayName)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                if let team = store.selectedTeam { Text(team.name) }
            }
        }
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search teammates")
        .navigationTitle("Add people")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard members == nil else { return }
            do { members = try await channel.teamMembers() } catch { if !Task.isCancelled { membersError = error.localizedDescription } }
        }
    }

    /// Always says whether to give use of the computer, as the Share sheet does.
    private func invite(_ id: String, name: String = "", grantComputerUse: Bool = false) {
        struct Body: Encodable { let userIds: [String]; let grantComputerUse: Bool }
        pending = id
        Task {
            defer { pending = nil }
            do {
                access = try await channel.access("POST", body: Body(userIds: [id], grantComputerUse: grantComputerUse))
            } catch where !grantComputerUse && ComputerUse.needsConfirmation(error) {
                needsComputer = (id, name)
            } catch {
                failure = Failure(title: "Couldn’t add this person", message: error.localizedDescription)
            }
        }
    }

    // MARK: - Leaving

    private func leave() {
        guard let viewerId else { return }
        run("leave", "Couldn’t leave the chat") {
            _ = try await channel.access("DELETE", "participants/\(viewerId)")
            dismiss()
            onLeft()
        }
    }

    private func run(_ key: String, _ title: LocalizedStringKey, _ request: @escaping () async throws -> Void) {
        pending = key
        Task {
            defer { pending = nil }
            do { try await request() } catch { failure = Failure(title: title, message: error.localizedDescription) }
        }
    }

    private var leaveMessage: LocalizedStringResource {
        switch ChannelLeave(people: (access?.participants ?? []).map { ($0.id, $0.user.displayName, $0.isOwner) }, viewerId: viewerId) {
        case .archives: "You’re the last one here, so the chat is archived."
        case .handsOver(let name): "\(name) becomes the owner. You can come back only if someone adds you."
        case .leaves: "You can come back only if someone adds you."
        }
    }
}

/// A Bot's dot and the word for whether it can reply now.
private struct PresenceTag: View {
    let presence: BotPresence

    var body: some View {
        let tag = presence.tag
        HStack(spacing: 6) {
            Circle().fill(color(tag.tone)).frame(width: 6, height: 6)
            Text(tag.word).font(.caption).foregroundStyle(Theme.muted)
        }
    }

    private func color(_ tone: BotPresence.Tone) -> Color {
        switch tone {
        case .ready: Theme.success
        case .waiting: Theme.attention
        case .down: .red
        }
    }
}
