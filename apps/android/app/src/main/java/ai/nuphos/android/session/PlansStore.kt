package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.Plan

/** Plans opened from a link. Agents now ask for approval in the Inbox, so there is no Plans list. */
class PlansStore(private val token: String) {
    var plans: List<Plan> by mutableStateOf(emptyList())
        private set
    var actionError: String? by mutableStateOf(null)

    fun plan(id: String): Plan? = plans.firstOrNull { it.id == id }

    fun apply(plan: Plan) {
        val i = plans.indexOfFirst { it.id == plan.id }
        plans = if (i >= 0) plans.toMutableList().also { it[i] = plan } else listOf(plan) + plans
    }

    suspend fun approve(plan: Plan): Plan {
        val team = plan.teamId ?: throw NuphosApi.Failure.InvalidResponse
        val updated = AgentChatApi.updatePlan(token, team, plan.id, "approved")
        apply(updated)
        return updated
    }

    suspend fun markUnplanned(plan: Plan) {
        val team = plan.teamId ?: return
        apply(plan.copy(status = "cancelled"))
        try {
            apply(AgentChatApi.updatePlan(token, team, plan.id, "cancelled"))
        } catch (e: Exception) {
            actionError = e.message
            apply(plan)
        }
    }

    suspend fun fetch(planId: String, teamId: String?): Plan {
        val team = teamId ?: throw NuphosApi.Failure.InvalidResponse
        val plan = AgentChatApi.plan(token, team, planId)
        apply(plan)
        return plan
    }
}
