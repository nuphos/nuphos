import Foundation
import Observation

/// Plans opened from a link: the fetched plans, the members that made them,
/// and the approve / mark-unplanned actions their page offers. Agents now
/// ask for approval in the Inbox, so there is no Plans list.
@Observable
final class PlansStore {
    private(set) var plans: [Plan] = []
    private(set) var members: [String: TeamMember] = [:]
    private var membersTeamId: String?

    private let token: String

    init(token: String) {
        self.token = token
    }

    func plan(_ id: String) -> Plan? { plans.first { $0.id == id } }

    func member(_ userId: String) -> TeamMember? { members[userId] }

    /// Keyed by user id; an active entry wins over a removed one for a user
    /// who was re-invited.
    private static func index(_ list: [TeamMember]) -> [String: TeamMember] {
        var map: [String: TeamMember] = [:]
        for member in list {
            if let existing = map[member.id], !existing.isRemoved, member.isRemoved { continue }
            map[member.id] = member
        }
        return map
    }

    /// Replaces (or inserts) the authoritative row from a fetch or PATCH.
    func apply(_ plan: Plan) {
        if let i = plans.firstIndex(where: { $0.id == plan.id }) {
            plans[i] = plan
        } else {
            plans.insert(plan, at: 0)
        }
    }

    /// Records one approval against the policy snapshot. The response stays
    /// `proposed` until the quorum is met.
    @discardableResult
    func approve(_ plan: Plan) async throws -> Plan {
        guard let teamId = plan.teamId else { throw NuphosAPI.Failure.invalidResponse }
        let updated = try await AgentChatAPI.updatePlan(token: token, teamId: teamId, planId: plan.id, status: "approved")
        Analytics.shared.track("agent_plan_approved", teamID: teamId, properties: ["plan_id": plan.id])
        apply(updated)
        return updated
    }

    /// "Mark as unplanned": optimistic flip to `cancelled`, then PATCH; a
    /// failure puts the plan back.
    func markUnplanned(_ plan: Plan) async {
        guard let teamId = plan.teamId else { return }
        var optimistic = plan
        optimistic.status = "cancelled"
        apply(optimistic)
        do {
            apply(try await AgentChatAPI.updatePlan(token: token, teamId: teamId, planId: plan.id, status: "cancelled"))
        } catch {
            apply(plan)
        }
    }

    func fetch(_ planId: String, teamId: String) async throws -> Plan {
        let plan = try await AgentChatAPI.plan(token: token, teamId: teamId, planId: planId)
        apply(plan)
        if membersTeamId != teamId, let list = try? await NuphosAPI.teamMembers(token: token, teamId: teamId) {
            members = Self.index(list)
            membersTeamId = teamId
        }
        return plan
    }
}
