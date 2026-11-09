import SwiftUI

/// Shared by Account and the login screen, including before AI consent.
struct SavedAccountsView: View {
    @Environment(AuthSession.self) private var session
    var allowAdding = false
    @State private var removing: SavedAccount?

    private var accounts: [SavedAccount] { session.savedAccounts.accounts }
    private var busy: Bool { session.state == .signingIn }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(accounts) { account in
                accountRow(account)
                if account.id != accounts.last?.id || allowAdding { separator }
            }
            if allowAdding {
                Button { session.addAccount() } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "plus")
                            .font(.body.weight(.medium))
                            .frame(width: 36, height: 36)
                            .background(Theme.canvas, in: Circle())
                        Text("Add account").font(.body)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(Theme.heading)
                    .frame(minHeight: 44)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(busy)
            }
            if let error = session.accountError { errorMessage(error) }
            if let error = session.savedAccounts.error { errorMessage(error) }
            if session.addingAccount {
                Button("Cancel adding account") { Task { await session.cancelAddAccount() } }
                    .frame(minHeight: 44).padding(.top, 8)
                    .disabled(busy)
            }
        }
        .confirmationDialog("Sign out of this account?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("Sign out", role: .destructive) {
                if let account = removing { session.removeAccount(account.id) }
                removing = nil
            }
        }
    }

    private func accountRow(_ account: SavedAccount) -> some View {
        let active = session.token != nil && session.savedAccounts.active?.id == account.id
        return HStack(spacing: 4) {
            Button { Task { await session.selectAccount(account.id) } } label: {
                HStack(spacing: 12) {
                    AvatarView(user: account.user, size: 36)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(account.user.displayName)
                            .font(.body.weight(.medium)).foregroundStyle(Theme.heading)
                        Text(account.user.email)
                            .font(.footnote).foregroundStyle(Theme.body)
                        if let server = serverLabel(account.origin) {
                            Text(server).font(.caption2).foregroundStyle(Theme.muted)
                                .accessibilityLabel("Server: \(account.origin)")
                        }
                        if account.token == nil {
                            Text("Sign in again").font(.caption).foregroundStyle(Theme.warning)
                        }
                    }
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if active {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.body).foregroundStyle(Theme.heading)
                            .accessibilityLabel("Active account")
                    }
                }
                .frame(minHeight: 44)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(busy)
            .accessibilityAddTraits(active ? .isSelected : [])
            Menu {
                Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { removing = account }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body.weight(.medium)).foregroundStyle(Theme.muted)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Account options for \(account.user.email)")
            .disabled(busy)
        }
    }

    private var separator: some View { Divider().padding(.leading, 48) }

    private func serverLabel(_ origin: String) -> String? {
        guard let url = URL(string: origin), url != NuphosAPI.defaultBaseURL else { return nil }
        guard let host = url.host else { return origin }
        return url.port.map { "\(host):\($0)" } ?? host
    }

    private func errorMessage(_ text: String) -> some View {
        Text(text).font(.footnote).foregroundStyle(.red).padding(.vertical, 8)
    }
}
