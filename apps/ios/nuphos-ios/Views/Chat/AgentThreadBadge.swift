import SwiftUI

/// Scoped to this transcript: repeated references share one read per refresh.
@Observable @MainActor
final class ReferencedAgents {
    var details: [String: AgentConversationDetail] = [:]
    var unavailable: Set<String> = []
    private var reading: Set<String> = []
    private var lastRead: [String: TimeInterval] = [:]

    func read(id: String, team: String, token: String) async {
        let key = "\(team)/\(id)"
        let now = ProcessInfo.processInfo.systemUptime
        guard !reading.contains(key), now - (lastRead[key] ?? 0) >= 4 else { return }
        reading.insert(key)
        defer { reading.remove(key); lastRead[key] = ProcessInfo.processInfo.systemUptime }
        do {
            let detail = try await NuphosAPI.conversationDetail(token: token, teamId: team, sessionId: id, tail: 1, displayed: false)
            details[key] = detail
            unavailable.remove(key)
            RuntimeObservations.shared.receive(detail.runtimeState, team: team, session: id, observedAt: now)
        } catch {
            if details[key] == nil { unavailable.insert(key) }
        }
    }
}

struct AgentThreadBadge: View {
    let reference: ThreadReference
    let teamId: String
    let agents: ReferencedAgents
    let onLink: (URL) -> Void
    @Environment(AuthSession.self) private var auth
    @Environment(\.scenePhase) private var scenePhase

    private var key: String { "\(teamId)/\(reference.id)" }
    private var detail: AgentConversationDetail? { agents.details[key] }
    private var observation: RuntimeObservation? { RuntimeObservations.shared.value(team: teamId, session: reference.id) }
    private var status: String {
        guard detail != nil else { return agents.unavailable.contains(key) ? "Unavailable" : "" }
        guard let observation, !observation.unavailable else { return "Unavailable" }
        if observation.paused { return "Stopped" }
        if (observation.snapshot["permissionWaits"]?.numberValue ?? 0) > 0 { return "Needs input" }
        if observation.turnActive || observation.backgroundRunning { return "Running" }
        return "Done"
    }

    var body: some View {
        Button {
            if let url = SessionLink.url(teamId: teamId, sessionId: reference.id) { onLink(url) }
        } label: {
            HStack(spacing: 8) {
                AgentAvatar(agentId: reference.id, runtime: detail?.agentRuntime)
                VStack(alignment: .leading, spacing: 2) {
                    Text(detail?.title ?? reference.title ?? "Agent")
                        .font(Theme.Text.caption.weight(.medium)).foregroundStyle(Theme.heading).lineLimit(1)
                    HStack(spacing: 8) {
                        Text(reference.verb)
                        if status == "Running" { ProgressView().controlSize(.mini) }
                        Text(status)
                    }
                    .font(Theme.Text.micro).foregroundStyle(Theme.muted)
                }
                Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.muted)
            }
            .padding(8)
            .background(Theme.chatSurface, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.hairline))
        }
        .buttonStyle(.plain)
        .disabled(agents.unavailable.contains(key))
        .task(id: scenePhase) {
            guard scenePhase == .active, let token = auth.token else { return }
            while !Task.isCancelled {
                await agents.read(id: reference.id, team: teamId, token: token)
                // Idle targets can restart; keep visible observations within their freshness window.
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }
}
