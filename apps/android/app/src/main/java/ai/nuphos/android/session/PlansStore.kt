package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.Plan
import ai.nuphos.android.model.PlanApprovalRequirement
import ai.nuphos.android.model.TeamMember
import java.time.Instant

class PlansStore(private val token: String) {
    enum class Phase { Idle, Loading, Loaded, Failed }

    val pageSize = 50

    var teamId: String? by mutableStateOf(null)
        private set
    var plans: List<Plan> by mutableStateOf(emptyList())
        private set
    var phase: Phase by mutableStateOf(Phase.Idle)
        private set
    var phaseError: String? by mutableStateOf(null)
        private set
    var isLoadingMore by mutableStateOf(false)
        private set
    var hasMore by mutableStateOf(false)
        private set
    private var nextCursor: String? = null

    var members: Map<String, TeamMember> by mutableStateOf(emptyMap())
        private set
    var approvalPolicy: PlanApprovalRequirement? by mutableStateOf(null)
        private set
    var actionError: String? by mutableStateOf(null)

    var showDismissed by mutableStateOf(false)
    var search by mutableStateOf("")

    private var loadGeneration = 0

    val rows: List<Plan>
        get() {
            val query = search.trim().lowercase()
            var all = plans
            all = if (query.isNotEmpty()) {
                val number = if (query.startsWith("#")) query.drop(1) else query
                all.filter { plan ->
                    plan.number?.toString() == number || plan.title.lowercase().contains(query)
                }
            } else if (!showDismissed) {
                all.filter { !it.isDismissed }
            } else {
                all
            }
            return all.sortedByDescending { it.createdAt ?: Instant.EPOCH }
        }

    val hasDismissed: Boolean get() = plans.any { it.isDismissed }

    fun plan(id: String): Plan? = plans.firstOrNull { it.id == id }

    fun member(userId: String): TeamMember? = members[userId]

    suspend fun use(teamId: String?) {
        if (teamId == this.teamId && phase != Phase.Idle) return
        this.teamId = teamId
        plans = emptyList()
        members = emptyMap()
        approvalPolicy = null
        phase = Phase.Idle
        reload()
    }

    suspend fun reload() {
        val teamId = teamId
        if (teamId == null) {
            plans = emptyList()
            phase = Phase.Loading
            return
        }
        loadGeneration += 1
        val generation = loadGeneration
        if (plans.isEmpty()) phase = Phase.Loading
        try {
            val page = AgentChatApi.listPlans(token, teamId, pageSize)
            if (generation != loadGeneration) return
            plans = page.plans
            nextCursor = page.nextCursor
            hasMore = page.hasMore
            phase = Phase.Loaded
            phaseError = null
        } catch (e: Exception) {
            if (generation != loadGeneration) return
            phase = Phase.Failed
            phaseError = e.message
        }
        runCatching { NuphosApi.teamMembers(token, teamId) }.getOrNull()?.let { list ->
            if (generation == loadGeneration) members = index(list)
        }
        runCatching { AgentChatApi.planApprovalPolicy(token, teamId) }.getOrNull()?.let { policy ->
            if (generation == loadGeneration) approvalPolicy = policy
        }
    }

    suspend fun silentRefresh() {
        val teamId = teamId
        if (teamId == null || phase != Phase.Loaded || isLoadingMore || plans.size > pageSize) return
        val generation = loadGeneration
        val page = runCatching { AgentChatApi.listPlans(token, teamId, pageSize) }.getOrNull() ?: return
        if (generation != loadGeneration) return
        plans = page.plans
        nextCursor = page.nextCursor
        hasMore = page.hasMore
    }

    suspend fun loadMore() {
        val teamId = teamId
        val cursor = nextCursor
        if (!hasMore || isLoadingMore || teamId == null || cursor == null) return
        isLoadingMore = true
        val generation = loadGeneration
        try {
            val page = AgentChatApi.listPlans(token, teamId, pageSize, cursor)
            if (generation != loadGeneration) return
            val seen = plans.map { it.id }.toSet()
            plans = plans + page.plans.filter { it.id !in seen }
            nextCursor = page.nextCursor
            hasMore = page.hasMore
        } catch (e: Exception) {
            actionError = e.message
        } finally {
            isLoadingMore = false
        }
    }

    fun apply(plan: Plan) {
        val i = plans.indexOfFirst { it.id == plan.id }
        plans = if (i >= 0) plans.toMutableList().also { it[i] = plan } else listOf(plan) + plans
    }

    suspend fun approve(plan: Plan): Plan {
        val team = plan.teamId ?: teamId ?: throw NuphosApi.Failure.InvalidResponse
        val updated = AgentChatApi.updatePlan(token, team, plan.id, "approved")
        apply(updated)
        return updated
    }

    suspend fun markUnplanned(plan: Plan) {
        val team = plan.teamId ?: teamId ?: return
        apply(plan.copy(status = "cancelled"))
        try {
            apply(AgentChatApi.updatePlan(token, team, plan.id, "cancelled"))
        } catch (e: Exception) {
            actionError = e.message
            reload()
        }
    }

    suspend fun fetch(planId: String, teamId: String? = null): Plan {
        val team = teamId ?: this.teamId ?: throw NuphosApi.Failure.InvalidResponse
        val plan = AgentChatApi.plan(token, team, planId)
        apply(plan)
        return plan
    }

    suspend fun updateApprovalPolicy(minimumOtherApprovals: Int) {
        val teamId = teamId ?: return
        approvalPolicy = AgentChatApi.updatePlanApprovalPolicy(token, teamId, minimumOtherApprovals)
        reload()
    }

    private fun index(list: List<TeamMember>): Map<String, TeamMember> {
        val map = mutableMapOf<String, TeamMember>()
        for (member in list) {
            val existing = map[member.id]
            if (existing != null && !existing.isRemoved && member.isRemoved) continue
            map[member.id] = member
        }
        return map
    }
}
