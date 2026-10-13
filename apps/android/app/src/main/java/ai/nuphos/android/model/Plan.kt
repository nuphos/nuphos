package ai.nuphos.android.model

import ai.nuphos.android.data.Instants
import ai.nuphos.android.data.JsonValue
import java.time.Instant

data class Plan(
    val id: String,
    val teamId: String? = null,
    val number: Int? = null,
    val title: String = "Plan",
    val overview: String = "",
    var status: String = "proposed",
    val steps: List<Step> = emptyList(),
    val decisions: List<Decision> = emptyList(),
    val costSummary: String? = null,
    val costOneTime: String? = null,
    val costMonthly: String? = null,
    val costSavings: String? = null,
    val riskWorstCase: String? = null,
    val riskMitigations: List<String> = emptyList(),
    val approvalProgress: ApprovalProgress? = null,
    val approvalCount: Int = 0,
    val executionError: String? = null,
    val createdBy: String = "",
    val createdAt: Instant? = null,
    val updatedAt: Instant? = null,
    val sourceConversationId: String? = null,
    val hasActions: Boolean = false,
) {
    data class Command(
        val command: String,
        val description: String? = null,
        val status: String? = null,
        val stdout: String? = null,
        val stderr: String? = null,
        val exitCode: Int? = null,
    )

    data class Job(
        val title: String,
        val description: String? = null,
        val commands: List<Command> = emptyList(),
    )

    data class Step(
        val title: String,
        val description: String? = null,
        val jobs: List<Job> = emptyList(),
    ) {
        val commands: List<Command> get() = jobs.flatMap { it.commands }

        val rollupStatus: String?
            get() {
                val statuses = commands.map { it.status ?: "pending" }
                if (statuses.isEmpty()) return null
                if (statuses.contains("failed")) return "failed"
                if (statuses.all { it == "done" }) return "done"
                if (statuses.contains("running")) return "running"
                if (statuses.contains("done")) return "partial"
                return "pending"
            }
    }

    data class Decision(val label: String, val value: String)

    data class ApprovalProgress(
        val requesterApproved: Boolean,
        val requesterApprovalRequired: Boolean,
        val otherApprovals: Int,
        val minimumOtherApprovals: Int,
        val satisfied: Boolean,
    ) {
        val remaining: Int
            get() = maxOf(
                0,
                (if (requesterApprovalRequired && !requesterApproved) 1 else 0) +
                    minimumOtherApprovals - otherApprovals,
            )
    }

    data class Progress(val done: Int, val failed: Int, val total: Int) {
        val fraction: Double get() = if (total == 0) 0.0 else done.toDouble() / total
    }

    val isActive: Boolean get() = status in setOf("proposed", "approved", "executing")
    val isCancellable: Boolean get() = isActive
    val isDismissed: Boolean get() = status == "rejected" || status == "cancelled"

    val isReadyForApproval: Boolean
        get() {
            fun hasText(s: String?) = !s.isNullOrBlank()
            return steps.isNotEmpty() &&
                steps.all { it.jobs.isNotEmpty() } &&
                hasText(costSummary) &&
                hasText(riskWorstCase) &&
                riskMitigations.any { hasText(it) }
        }

    val displayNumber: String get() = number?.let { "#$it" } ?: "#$id"

    val progress: Progress
        get() {
            val statuses = steps.map { it.rollupStatus ?: "pending" }
            return Progress(
                done = statuses.count { it == "done" },
                failed = statuses.count { it == "failed" },
                total = statuses.size,
            )
        }

    val totalJobs: Int get() = steps.sumOf { it.jobs.size }
    val totalCommands: Int get() = steps.sumOf { it.commands.size }

    companion object {
        fun from(json: JsonValue): Plan? {
            val id = json["id"]?.stringValue ?: json["id"]?.numberValue?.toInt()?.toString() ?: return null
            val decisions = (json["decisions"]?.arrayValue ?: emptyList()).mapNotNull { d ->
                d.stringValue?.let { Decision("", it) }
                    ?: d["value"]?.stringValue?.let { Decision(d["label"]?.stringValue.orEmpty(), it) }
            }
            val steps = (json["steps"]?.arrayValue ?: emptyList()).map { s ->
                Step(
                    title = s["title"]?.stringValue.orEmpty(),
                    description = s["description"]?.stringValue,
                    jobs = (s["jobs"]?.arrayValue ?: emptyList()).map { j ->
                        Job(
                            title = j["title"]?.stringValue.orEmpty(),
                            description = j["description"]?.stringValue,
                            commands = (j["commands"]?.arrayValue ?: emptyList()).map { c ->
                                Command(
                                    command = c["command"]?.stringValue.orEmpty(),
                                    description = c["description"]?.stringValue,
                                    status = c["status"]?.stringValue,
                                    stdout = c["stdout"]?.stringValue,
                                    stderr = c["stderr"]?.stringValue,
                                    exitCode = c["exitCode"]?.numberValue?.toInt(),
                                )
                            },
                        )
                    },
                )
            }
            val ap = json["approvalProgress"]
            return Plan(
                id = id,
                teamId = json["teamId"]?.stringValue,
                number = json["number"]?.numberValue?.toInt(),
                title = json["title"]?.stringValue ?: "Plan",
                overview = json["overview"]?.stringValue.orEmpty(),
                status = json["status"]?.stringValue ?: "proposed",
                steps = steps,
                decisions = decisions,
                costSummary = json["costSummary"]?.stringValue,
                costOneTime = json["costOneTime"]?.stringValue,
                costMonthly = json["costMonthly"]?.stringValue,
                costSavings = json["costSavings"]?.stringValue,
                riskWorstCase = json["riskWorstCase"]?.stringValue,
                riskMitigations = json["riskMitigations"]?.arrayValue?.mapNotNull { it.stringValue } ?: emptyList(),
                executionError = json["executionError"]?.stringValue,
                createdBy = json["createdBy"]?.stringValue.orEmpty(),
                createdAt = Instants.parse(json["createdAt"]?.stringValue),
                updatedAt = Instants.parse(json["updatedAt"]?.stringValue),
                sourceConversationId = json["sourceConversationId"]?.stringValue,
                hasActions = json["actions"]?.arrayValue?.isNotEmpty() == true,
                approvalCount = json["approvals"]?.arrayValue?.size ?: 0,
                approvalProgress = ap?.let {
                    ApprovalProgress(
                        requesterApproved = it["requesterApproved"]?.boolValue ?: false,
                        requesterApprovalRequired = it["requesterApprovalRequired"]?.boolValue ?: false,
                        otherApprovals = it["otherApprovals"]?.numberValue?.toInt() ?: 0,
                        minimumOtherApprovals = it["minimumOtherApprovals"]?.numberValue?.toInt() ?: 0,
                        satisfied = it["satisfied"]?.boolValue ?: false,
                    )
                },
            )
        }
    }
}

data class PlanListPage(
    val plans: List<Plan>,
    val nextCursor: String?,
    val hasMore: Boolean,
)

data class PlanApprovalRequirement(
    val requesterApprovalRequired: Boolean = true,
    val minimumOtherApprovals: Int = 0,
) {
    constructor(json: JsonValue) : this(
        requesterApprovalRequired = json["requesterApprovalRequired"]?.boolValue ?: true,
        minimumOtherApprovals = json["minimumOtherApprovals"]?.numberValue?.toInt() ?: 0,
    )

    val summary: String
        get() = if (minimumOtherApprovals == 0) {
            "Requester only"
        } else {
            val s = if (minimumOtherApprovals == 1) "" else "s"
            "Requester + $minimumOtherApprovals other member$s"
        }
}

data class PlanRoute(val planId: String)

data class PlanChatTarget(
    val planId: String,
    val sessionId: String,
    val title: String,
    val proceedMessage: String?,
    val buttonTitle: String,
) {
    companion object {
        fun from(plan: Plan): PlanChatTarget? {
            val sessionId = plan.sourceConversationId?.takeIf { it.isNotEmpty() } ?: return null
            val (proceed, button) = when (plan.status) {
                "proposed" -> null to "Continue in chat"
                "approved" -> "Approved plan #${plan.id} — please proceed with plan #${plan.id}." to "Continue in chat"
                else -> null to "Open in chat"
            }
            return PlanChatTarget(plan.id, sessionId, plan.title, proceed, button)
        }
    }
}
