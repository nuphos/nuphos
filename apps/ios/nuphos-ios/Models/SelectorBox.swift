import Foundation

/// The existing device catalog, including its explicit access and metrics freshness.
struct AgentDevice: Decodable, Sendable {
    struct Box: Decodable, Sendable { let state: String }
    struct Metrics: Decodable, Sendable {
        struct Capacity: Decodable, Sendable {
            let used: Double
            let total: Double
            var percent: Double? {
                guard used.isFinite, total.isFinite, used >= 0, total > 0, used <= total else { return nil }
                return used / total * 100
            }
            var formatted: String { "\((used / 1_073_741_824).formatted(.number.precision(.fractionLength(0...1)))) / \((total / 1_073_741_824).formatted(.number.precision(.fractionLength(0...1)))) GB" }
        }
        let cpuPercent: Double
        let memory: Capacity
        let disk: Capacity
    }
    let deviceId: String
    let label: String
    let online: Bool?
    let access: String?
    let box: Box?
    let metricsStatus: String?
    let metrics: Metrics?
    var liveMetrics: Metrics? { online != false && metricsStatus == "live" ? metrics : nil }
}

struct SelectorBox: Identifiable {
    let id: String
    let label: String
    let device: AgentDevice?
    var agents: [RuntimeInstance]
    var offline: Bool { device?.online == false || agents.allSatisfy { $0.status != .active } }
    var isComputer: Bool { device?.box == nil && agents.first?.local != nil }

    static func grouped(_ agents: [RuntimeInstance], devices: [AgentDevice]) -> [SelectorBox] {
        var groups: [SelectorBox] = []
        for agent in agents {
            let id = agent.local.map { "device:\($0.deviceId)" } ?? (agent.kind == "managed" ? "cloud" : "runtime:\(agent.id)")
            if let index = groups.firstIndex(where: { $0.id == id }) { groups[index].agents.append(agent) }
            else {
                let device = devices.first { $0.deviceId == agent.local?.deviceId }
                groups.append(.init(id: id, label: device?.label ?? agent.local?.deviceLabel ?? (id == "cloud" ? "Cloud" : agent.label), device: device, agents: [agent]))
            }
        }
        return groups
    }

    func canSignIn(_ runtime: RuntimeInstance, administrator: Bool) -> Bool {
        if runtime.local != nil { return device?.box != nil && device?.access != "use" }
        return administrator
    }

    /// Inside its computer a runtime goes by its own name, or its provider's; never "<name> in <computer>".
    static func agentName(_ runtime: RuntimeInstance) -> String {
        guard let local = runtime.local else { return runtime.label }
        return local.agentLabel ?? runtime.providerName
    }
}
