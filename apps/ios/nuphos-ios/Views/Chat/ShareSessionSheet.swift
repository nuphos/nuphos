import SwiftUI

/// `ConversationAccessState` in the desktop's `api/agent-types.ts`: a
/// team-wide general access plus a role for each invited person.
struct SessionAccess: Decodable, Equatable {
    enum General: String, Decodable, CaseIterable {
        case onlyInvited = "none", view, reply

        var title: LocalizedStringKey {
            switch self {
            case .onlyInvited: "Only people invited"
            case .view: "Team can view"
            case .reply: "Team can view and reply"
            }
        }
    }

    enum Role: String, CaseIterable {
        case manage, reply, view

        var title: LocalizedStringKey {
            switch self {
            case .manage: "Can manage"
            case .reply: "Can reply"
            case .view: "Can view"
            }
        }

        var rank: Int {
            switch self {
            case .view: 1
            case .reply: 2
            case .manage: 3
            }
        }

        /// What general access already gives everyone: a role below it changes nothing.
        static func floor(_ general: General) -> Role? {
            switch general {
            case .onlyInvited: nil
            case .view: .view
            case .reply: .reply
            }
        }
    }

    struct Participant: Decodable, Identifiable, Equatable {
        let id: String
        let name: String
        let email: String
        let avatarURL: String?
        let deactivated: Bool?
        let isOwner: Bool
        /// `owner` | `view` | `reply` | `manage`.
        let role: String?

        var user: NuphosUser { NuphosUser(id: id, email: email, name: name, username: "", avatarURL: avatarURL ?? "") }

        /// The broader of their own role and the team-wide grant.
        func effectiveRole(_ general: General) -> Role {
            let own = role.flatMap(Role.init) ?? .view
            guard let floor = Role.floor(general), floor.rank > own.rank else { return own }
            return floor
        }
    }

    var generalAccess: General
    var participants: [Participant]
}

/// Who may open this session — the desktop's Share card
/// (`SessionParticipants.tsx`). The broader grant wins, the way Notion
/// resolves it. Only the owner changes any of it; everyone else sees who is
/// here and what they may do.
struct ShareSessionSheet: View {
    let session: ChatSession

    @Environment(AuthSession.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var access: SessionAccess?
    @State private var members: [TeamMember]?
    @State private var membersError: String?
    /// An invite that would let someone run commands on the owner's computer, awaiting confirmation.
    @State private var pendingInvite: TeamMember?
    @State private var inviteRole = SessionAccess.Role.reply
    @State private var search = ""
    /// What a request is changing: `access`, or a user id.
    @State private var pending: String?
    @State private var loadError: String?
    @State private var error: String?

    private var canManage: Bool { session.ownsChat }

    /// The owner's own computer runs the turn, so sharing hands out commands on it.
    private var runsOnOwnersComputer: Bool {
        canManage && RuntimeInstance.isLocalAgent(session.runtimeId)
    }

    var body: some View {
        NavigationStack {
            List {
                if let link = SessionLink.url(teamId: session.teamId, sessionId: session.sessionId) {
                    Section {
                        ShareLink(item: link) { Label("Share link", systemImage: "link") }
                    }
                    .listRowBackground(Theme.surface)
                }
                if let access {
                    sections(access)
                } else if let loadError {
                    Text(loadError).foregroundStyle(Theme.muted).listRowBackground(Theme.surface)
                } else {
                    ProgressView().frame(maxWidth: .infinity).listRowBackground(Color.clear)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.canvas)
            .navigationTitle("Share")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .alert("Couldn't update sharing", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
            .alert("Let \(pendingInvite?.displayName ?? "") use your computer?", isPresented: Binding(get: { pendingInvite != nil }, set: { if !$0 { pendingInvite = nil } }), presenting: pendingInvite) { member in
                Button("Invite") { invite(member) }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("This session runs on your computer’s Local Agent. They will be able to run commands on your computer.")
            }
            .task {
                do { access = try await session.access("GET") } catch { loadError = error.localizedDescription }
            }
            .task {
                guard canManage else { return }
                do { members = try await session.teamMembers() } catch { membersError = error.localizedDescription }
            }
        }
        .tint(Theme.heading)
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func sections(_ access: SessionAccess) -> some View {
        Section {
            if canManage {
                Picker("Team access", selection: Binding(get: { access.generalAccess }, set: { value in
                    change("access") { try await session.access("PATCH", "access", body: ["generalAccess": value.rawValue]) }
                })) {
                    ForEach(SessionAccess.General.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                .disabled(pending != nil)
            } else {
                LabeledContent("Team access") { Text(access.generalAccess.title) }
            }
            if runsOnOwnersComputer {
                Label("This session runs on your computer’s Local Agent. Anyone you share it with can run commands on your computer.", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(Theme.warning)
            }
        } header: {
            Text("General access")
        }
        .listRowBackground(Theme.surface)

        Section {
            ForEach(access.participants) { participant in
                participantRow(participant, general: access.generalAccess)
            }
        } header: {
            Text("In this session")
        } footer: {
            if !canManage { Text("Only the owner can change who has access.") }
        }
        .listRowBackground(Theme.surface)

        if canManage { inviteSection(joined: Set(access.participants.map(\.id))) }
    }

    private func participantRow(_ participant: SessionAccess.Participant, general: SessionAccess.General) -> some View {
        let role = participant.effectiveRole(general)
        return HStack(spacing: 12) {
            AvatarView(user: participant.user, size: 28)
                .opacity(participant.deactivated == true ? 0.5 : 1)
            Text(participant.id == auth.user?.id ? "\(participant.user.displayName) (you)" : participant.user.displayName)
                .lineLimit(1)
            Spacer(minLength: 8)
            if participant.isOwner {
                Text("Owner").foregroundStyle(Theme.muted)
            } else if canManage {
                if pending == participant.id {
                    ProgressView()
                } else {
                    Menu {
                        Picker("Role", selection: Binding(get: { role }, set: { next in
                            struct Body: Encodable { let role: String }
                            change(participant.id) { try await session.access("PATCH", "participants/\(participant.id)", body: Body(role: next.rawValue)) }
                        })) {
                            ForEach(SessionAccess.Role.allCases, id: \.self) { option in
                                Text(option.title).tag(option)
                                    .disabled((SessionAccess.Role.floor(general)?.rank ?? 0) > option.rank)
                            }
                        }
                        Button("Remove", systemImage: "person.badge.minus", role: .destructive) {
                            change(participant.id) { try await session.access("DELETE", "participants/\(participant.id)") }
                        }
                    } label: {
                        HStack(spacing: 2) {
                            Text(role.title)
                            Image(systemName: "chevron.up.chevron.down").imageScale(.small)
                        }
                        .foregroundStyle(Theme.body)
                    }
                    .disabled(pending != nil)
                }
            } else {
                Text(role.title).foregroundStyle(Theme.muted)
            }
        }
    }

    private func inviteSection(joined: Set<String>) -> some View {
        let query = search.trimmingCharacters(in: .whitespaces)
        let invitable = (members ?? []).filter { member in
            !joined.contains(member.id) && !member.isRemoved
                && (query.isEmpty || member.displayName.localizedCaseInsensitiveContains(query) || member.email.localizedCaseInsensitiveContains(query))
        }
        return Section {
            Picker("Invite as", selection: $inviteRole) {
                ForEach(SessionAccess.Role.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            if let membersError {
                Text(membersError).foregroundStyle(Theme.muted)
            } else if members == nil {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                TextField("Search teammates", text: $search)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                ForEach(invitable) { member in
                    Button {
                        if runsOnOwnersComputer, inviteRole != .view { pendingInvite = member } else { invite(member) }
                    } label: {
                        HStack(spacing: 12) {
                            AvatarView(user: member.asUser, size: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(member.displayName).foregroundStyle(Theme.heading).lineLimit(1)
                                Text(member.email).font(.caption).foregroundStyle(Theme.muted).lineLimit(1)
                            }
                            Spacer(minLength: 8)
                            if pending == member.id { ProgressView() } else { Image(systemName: "plus.circle").foregroundStyle(Theme.brandText) }
                        }
                    }
                    .disabled(pending != nil)
                }
            }
        } header: {
            Text("Add people")
        }
        .listRowBackground(Theme.surface)
    }

    private func invite(_ member: TeamMember) {
        struct Body: Encodable { let userIds: [String]; let role: String }
        let role = inviteRole.rawValue
        change(member.id) { try await session.access("POST", body: Body(userIds: [member.id], role: role)) }
    }

    private func change(_ key: String, _ request: @escaping () async throws -> SessionAccess) {
        pending = key
        Task {
            defer { pending = nil }
            do { access = try await request() } catch { self.error = error.localizedDescription }
        }
    }
}
