import Foundation

/// The existing device catalog, including its explicit access and metrics freshness.
struct AgentDevice: Decodable, Sendable {
    struct Box: Decodable, Sendable { let state: String }
    struct Metrics: Decodable, Sendable {
        struct Capacity: Decodable, Sendable {
            let used: Double
            let total: Double
            var valid: Bool { used.isFinite && total.isFinite && used >= 0 && total > 0 && used <= total }
            var percent: Double { used / total * 100 }
            var formatted: String { "\((used / 1_073_741_824).formatted(.number.precision(.fractionLength(0...1)))) / \((total / 1_073_741_824).formatted(.number.precision(.fractionLength(0...1)))) GB" }
        }
        let cpuPercent: Double
        let memory: Capacity
        let disk: Capacity
    }
    let deviceId: String
    let label: String
    let access: String?
    let box: Box?
    let metricsStatus: String?
    let metrics: Metrics?
    /// The id this computer opens its desktop by: present on the viewer's own online computer whose host can.
    var desktopRuntimeId: String? = nil
    /// A live, sane reading, or nil: the picker then shows no meters at all.
    var liveMetrics: Metrics? {
        guard metricsStatus == "live", let metrics, metrics.cpuPercent.isFinite, (0...100).contains(metrics.cpuPercent),
              metrics.memory.valid, metrics.disk.valid else { return nil }
        return metrics
    }
}

/// How the conversation's computer stands right now, as its chat tells it.
enum ComputerPresence: Equatable {
    case online, offline
    /// A paused Box, by its label: sending a message resumes it.
    case paused(label: String)

    /// Only the device list says an offline Box is paused. Until that list has
    /// loaded (`devices` nil) nothing is said, so a paused Box never shows offline first.
    static func of(_ local: RuntimeInstance.Local?, devices: [AgentDevice]?) -> ComputerPresence {
        guard let local, local.online == false else { return .online }
        guard let devices else { return .online }
        if let device = devices.first(where: { $0.deviceId == local.deviceId }), device.box?.state == "paused" {
            return .paused(label: device.label)
        }
        return .offline
    }
}

struct SelectorBox: Identifiable {
    let id: String
    let label: String
    let device: AgentDevice?
    var agents: [RuntimeInstance]
    var isComputer: Bool { device.map { $0.box == nil } ?? (agents.first?.local != nil) }

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
