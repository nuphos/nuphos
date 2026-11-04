import SwiftUI

/// `ConversationAccessState` in the desktop's `api/agent-types.ts`: who in the
/// team may read without an invite, and each person invited. A participant
/// replies while they may use the computer the session runs on.
struct SessionAccess: Decodable, Equatable {
    enum General: String, Decodable, CaseIterable {
        /// `reply` is a chat's only: a session's team reads, its invited people reply.
        case onlyInvited = "none", view, reply

        var title: LocalizedStringKey {
            switch self {
            case .onlyInvited: "Only people invited"
            case .view: "Team can view"
            case .reply: "Team can view and reply"
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
        /// `owner`, `reply`, or `view` for someone who cannot use the session's computer yet.
        let role: String?

        var user: NuphosUser { NuphosUser(id: id, email: email, name: name, username: "", avatarURL: avatarURL ?? "") }

        var canReply: Bool { role != "view" }
    }

    var generalAccess: General
    var participants: [Participant]
}

/// The backend refuses an invite with `computer_use_required` while an invitee
/// cannot use the session's computer, until the invite confirms giving them `use` of it.
enum ComputerUse {
    static func needsConfirmation(_ error: Error) -> Bool {
        if case AgentChatAPI.Conflict.other(code: "computer_use_required", _, _) = error { return true }
        return false
    }
}

/// Who may open this session — the desktop's Share card
/// (`SessionParticipants.tsx`). Inviting someone who cannot use the session's
/// computer asks before giving them use of it. Only the owner changes any of
/// it; everyone else sees who is here and what they may do.
struct ShareSessionSheet: View {
    let session: ChatSession

    @Environment(AuthSession.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var access: SessionAccess?
    @State private var members: [TeamMember]?
    @State private var membersError: String?
    /// An invite refused until it also gives this person use of the session's computer.
    @State private var needsComputer: (id: String, name: String)?
    @State private var search = ""
    /// What a request is changing: `access`, or a user id.
    @State private var pending: String?
    @State private var loadError: String?
    @State private var error: String?

    private var canManage: Bool { session.ownsChat }

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
            .alert("Also give use of this computer?", isPresented: Binding(get: { needsComputer != nil }, set: { if !$0 { needsComputer = nil } }), presenting: needsComputer) { person in
                Button("Continue") { invite(person.id, grantComputerUse: true) }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("Adding this person to the conversation also gives them use of this computer. Continue?")
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
    }

    @ViewBuilder
    private func sections(_ access: SessionAccess) -> some View {
        Section {
            if canManage {
                Picker("Team access", selection: Binding(get: { access.generalAccess }, set: { value in
                    change("access") { try await session.access("PATCH", "access", body: ["generalAccess": value.rawValue]) }
                })) {
                    ForEach(SessionAccess.General.allCases.filter { $0 != .reply || access.generalAccess == .reply }, id: \.self) { Text($0.title).tag($0) }
                }
                .disabled(pending != nil)
            } else {
                LabeledContent("Team access") { Text(access.generalAccess.title) }
            }
        } header: {
            Text("General access")
        }
        .listRowBackground(Theme.surface)

        Section {
            ForEach(access.participants) { participant in
                participantRow(participant)
            }
        } header: {
            Text("In this agent")
        } footer: {
            if !canManage { Text("Only the owner can change who has access.") }
        }
        .listRowBackground(Theme.surface)

        if canManage { inviteSection(joined: Set(access.participants.map(\.id))) }
    }

    private func participantRow(_ participant: SessionAccess.Participant) -> some View {
        let label: LocalizedStringKey = participant.canReply ? "Can reply" : "Can view"
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
                        if !participant.canReply {
                            // Inviting them again offers them use of the computer.
                            Button("Let them reply", systemImage: "bubble.left") {
                                invite(participant.id, name: participant.user.displayName)
                            }
                        }
                        Button("Remove", systemImage: "person.badge.minus", role: .destructive) {
                            change(participant.id) { try await session.access("DELETE", "participants/\(participant.id)") }
                        }
                    } label: {
                        HStack(spacing: 2) {
                            Text(label)
                            Image(systemName: "chevron.up.chevron.down").imageScale(.small)
                        }
                        .foregroundStyle(Theme.body)
                    }
                    .disabled(pending != nil)
                }
            } else {
                Text(label).foregroundStyle(Theme.muted)
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
                        invite(member.id, name: member.displayName)
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

    /// Always says whether to give use of the computer: a request without it
    /// comes from a release that predates asking, and invites to read only.
    private func invite(_ id: String, name: String = "", grantComputerUse: Bool = false) {
        struct Body: Encodable { let userIds: [String]; let grantComputerUse: Bool }
        pending = id
        Task {
            defer { pending = nil }
            do {
                access = try await session.access("POST", body: Body(userIds: [id], grantComputerUse: grantComputerUse))
            } catch where !grantComputerUse && ComputerUse.needsConfirmation(error) {
                needsComputer = (id, name)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func change(_ key: String, _ request: @escaping () async throws -> SessionAccess) {
        pending = key
        Task {
            defer { pending = nil }
            do { access = try await request() } catch { self.error = error.localizedDescription }
        }
    }
}
