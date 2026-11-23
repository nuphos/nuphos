import SwiftUI

/// Personal subscriptions; owning or sharing a computer never opts someone in.
struct ComputerNotificationsView: View {
    @Environment(AuthSession.self) private var session
    @Environment(AgentStore.self) private var store: AgentStore?
    @State private var selected: Set<String> = []
    @State private var loading = true
    @State private var saving: Set<String> = []
    @State private var error: String?

    private var computers: [RuntimeInstance.Local] {
        var seen = Set<String>()
        return (store?.runtimes ?? []).compactMap(\.local).filter { seen.insert($0.deviceId).inserted }
            .sorted { $0.deviceLabel.localizedStandardCompare($1.deviceLabel) == .orderedAscending }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.large) {
                VStack(alignment: .leading, spacing: Theme.Space.small) {
                    Text("Choose what matters")
                        .font(.system(size: 22, weight: .semibold)).foregroundStyle(Theme.heading)
                    Text("Follow the computers you rely on. Everything else stays quiet.")
                        .font(.system(size: 15)).foregroundStyle(Theme.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, Theme.Space.small)

                if loading { ProgressView().frame(maxWidth: .infinity).padding() }
                ForEach(computers, id: \.deviceId) { computer in
                    HStack(spacing: Theme.Space.medium) {
                        LucideIcon("laptop")
                            .font(.system(size: 20)).foregroundStyle(Theme.body)
                            .frame(width: 42, height: 42)
                            .background(Theme.sunken, in: RoundedRectangle(cornerRadius: Theme.Radius.button))
                        Toggle(isOn: Binding(
                            get: { selected.contains(computer.deviceId) },
                            set: { enabled in Task { await save(computer.deviceId, enabled: enabled) } }
                        )) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(computer.deviceLabel)
                                    .font(.system(size: 16, weight: .medium)).foregroundStyle(Theme.heading)
                                HStack(spacing: 6) {
                                    Circle().fill(computer.online == true ? Theme.success : Theme.muted.opacity(0.5))
                                        .frame(width: 6, height: 6)
                                    Text(computer.online == true ? "Online" : "Offline")
                                        .font(.system(size: 13)).foregroundStyle(Theme.muted)
                                }
                            }
                        }
                        .tint(Theme.heading)
                        .disabled(loading || saving.contains(computer.deviceId))
                        .accessibilityIdentifier("computer-notifications.\(computer.deviceId)")
                    }
                    .padding(Theme.Space.large)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.card))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card).stroke(Theme.outline, lineWidth: 0.5))
                }
                if !loading && computers.isEmpty {
                    Text("No computers in this team.").foregroundStyle(Theme.muted)
                        .padding(Theme.Space.large)
                }
                HStack(alignment: .top, spacing: Theme.Space.small) {
                    LucideIcon("info").font(.system(size: 14)).padding(.top, 2)
                    Text("Off by default. Selected computers notify you after 2 minutes offline and when they reconnect. Only your account is affected.")
                        .font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(Theme.muted)
                .padding(.top, Theme.Space.small)
                if let error {
                    VStack(alignment: .leading, spacing: Theme.Space.small) {
                        Text(error).foregroundStyle(Theme.attention)
                        Button("Try again") { Task { await load() } }
                    }
                }
            }
            .padding(Theme.Space.page)
        }
        .background(Theme.canvas)
        .navigationTitle("Computer notifications")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { await load() }
    }

    private func load() async {
        guard let token = session.token else { loading = false; return }
        loading = true
        defer { loading = false }
        do {
            await store?.loadRuntimes()
            struct Response: Decodable { let deviceIds: [String] }
            let data = try await AgentChatAPI.send("GET", "push/computer-subscriptions", token: token, body: Optional<Int>.none)
            selected = Set(try JSONDecoder().decode(Response.self, from: data).deviceIds)
            error = nil
        } catch { self.error = error.localizedDescription }
    }

    private func save(_ deviceId: String, enabled: Bool) async {
        guard let token = session.token else { return }
        saving.insert(deviceId)
        defer { saving.remove(deviceId) }
        do {
            struct Body: Encodable { let enabled: Bool }
            _ = try await AgentChatAPI.send("PUT", "push/computer-subscriptions/\(deviceId)", token: token, body: Body(enabled: enabled))
            if enabled { selected.insert(deviceId) } else { selected.remove(deviceId) }
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
