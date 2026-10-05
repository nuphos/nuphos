import Foundation
import Observation

/// The Plans library for one team: the plan pages, the members that made
/// them, the approval policy, and the mutations the page offers. Mirrors
/// the desktop's `usePlansCore` + `usePlanRowActions`.
@Observable
final class PlansStore {
    enum Phase: Equatable {
        case idle, loading, loaded, failed(String)
    }

    static let pageSize = 50

    private(set) var teamId: String?
    private(set) var plans: [Plan] = []
    private(set) var phase: Phase = .idle
    private(set) var isLoadingMore = false
    private(set) var hasMore = false
    private var nextCursor: String?

    private(set) var members: [String: TeamMember] = [:]
    private(set) var approvalPolicy: PlanApprovalRequirement?
    /// The most recent mutation failure, for an alert.
    var actionError: String?

    /// Default list hides dismissed (rejected / cancelled) plans.
    var showDismissed = false
    /// Client-side, like the desktop: an exact plan number or a title substring.
    var search = ""

    private let token: String
    private var loadGeneration = 0

    init(token: String) {
        self.token = token
    }

    // MARK: - Derived

    /// What the list shows. A search looks across everything, dismissed
    /// included, so a number lookup always resolves.
    var rows: [Plan] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var all = plans
        if !query.isEmpty {
            let number = query.hasPrefix("#") ? String(query.dropFirst()) : query
            all = all.filter { plan in
                plan.number.map { String($0) == number } == true || plan.title.lowercased().contains(query)
            }
        } else if !showDismissed {
            all = all.filter { !$0.isDismissed }
        }
        return all.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
    }

    /// Whether the loaded list has anything the toggle would reveal.
    var hasDismissed: Bool { plans.contains { $0.isDismissed } }

    func plan(_ id: String) -> Plan? { plans.first { $0.id == id } }

    func member(_ userId: String) -> TeamMember? { members[userId] }

    // MARK: - Loading

    /// Points the store at a team; reloads if it changed.
    func use(teamId: String?) async {
        guard teamId != self.teamId || phase == .idle else { return }
        self.teamId = teamId
        plans = []
        members = [:]
        approvalPolicy = nil
        phase = .idle
        await reload()
    }

    /// First page, replacing the list. Keeps the old rows on screen while
    /// loading so a refresh does not flash empty.
    func reload() async {
        // No team yet: keep spinning — the Agent store is still resolving it.
        guard let teamId else { plans = []; phase = .loading; return }
        loadGeneration += 1
        let generation = loadGeneration
        if plans.isEmpty { phase = .loading }

        async let membersTask = try? NuphosAPI.teamMembers(token: token, teamId: teamId)
        async let policyTask = try? AgentChatAPI.planApprovalPolicy(token: token, teamId: teamId)
        do {
            let page = try await AgentChatAPI.listPlans(token: token, teamId: teamId, limit: Self.pageSize)
            guard generation == loadGeneration else { return }
            plans = page.plans
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            phase = .loaded
        } catch {
            guard generation == loadGeneration else { return }
            phase = .failed(error.localizedDescription)
        }
        if let list = await membersTask, generation == loadGeneration { members = Self.index(list) }
        if let policy = await policyTask, generation == loadGeneration { approvalPolicy = policy }
    }

    /// The desktop's silent refresh: only while the first page is showing
    /// and nothing else is in flight; errors wait for the next foreground load.
    func silentRefresh() async {
        guard let teamId, phase == .loaded, !isLoadingMore, plans.count <= Self.pageSize else { return }
        let generation = loadGeneration
        guard let page = try? await AgentChatAPI.listPlans(token: token, teamId: teamId, limit: Self.pageSize),
              generation == loadGeneration else { return }
        plans = page.plans
        nextCursor = page.nextCursor
        hasMore = page.hasMore
    }

    func loadMore() async {
        guard hasMore, !isLoadingMore, let teamId, let cursor = nextCursor else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let generation = loadGeneration
        do {
            let page = try await AgentChatAPI.listPlans(token: token, teamId: teamId, limit: Self.pageSize, cursor: cursor)
            guard generation == loadGeneration else { return }
            let seen = Set(plans.map(\.id))
            plans.append(contentsOf: page.plans.filter { !seen.contains($0.id) })
            nextCursor = page.nextCursor
            hasMore = page.hasMore
        } catch {
            actionError = error.localizedDescription
        }
    }

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

    // MARK: - Mutations

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
        guard let teamId = plan.teamId ?? teamId else { throw NuphosAPI.Failure.invalidResponse }
        let updated = try await AgentChatAPI.updatePlan(token: token, teamId: teamId, planId: plan.id, status: "approved")
        Analytics.shared.track("agent_plan_approved", teamID: teamId, properties: ["plan_id": plan.id])
        apply(updated)
        return updated
    }

    /// "Mark as unplanned": optimistic flip to `cancelled`, then PATCH; a
    /// failure reloads to resync.
    func markUnplanned(_ plan: Plan) async {
        guard let teamId = plan.teamId ?? teamId else { return }
        var optimistic = plan
        optimistic.status = "cancelled"
        apply(optimistic)
        do {
            let updated = try await AgentChatAPI.updatePlan(token: token, teamId: teamId, planId: plan.id, status: "cancelled")
            apply(updated)
        } catch {
            actionError = error.localizedDescription
            await reload()
        }
    }

    /// `teamId` overrides the library's team — for a plan opened from a link.
    func fetch(_ planId: String, teamId: String? = nil) async throws -> Plan {
        guard let teamId = teamId ?? self.teamId else { throw NuphosAPI.Failure.invalidResponse }
        let plan = try await AgentChatAPI.plan(token: token, teamId: teamId, planId: planId)
        apply(plan)
        return plan
    }

    /// Administrators only; open plans must be re-approved under the new
    /// policy, so the list reloads.
    func updateApprovalPolicy(minimumOtherApprovals: Int) async throws {
        guard let teamId else { return }
        approvalPolicy = try await AgentChatAPI.updatePlanApprovalPolicy(token: token, teamId: teamId, minimumOtherApprovals: minimumOtherApprovals)
        await reload()
    }
}
