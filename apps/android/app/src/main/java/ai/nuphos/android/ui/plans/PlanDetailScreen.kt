package ai.nuphos.android.ui.plans

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import ai.nuphos.android.model.Plan
import ai.nuphos.android.model.PlanChatTarget
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalPlansStore
import ai.nuphos.android.ui.components.StatusBadge
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanDetailScreen(
    planId: String,
    nav: NavHostController,
    teamId: String? = null,
    showsChatActions: Boolean = true,
) {
    val plans = LocalPlansStore.current
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    var fetched by remember { mutableStateOf<Plan?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    val plan = plans.plan(planId) ?: fetched

    LaunchedEffect(planId) {
        while (isActive) {
            runCatching { plans.fetch(planId, teamId) }
                .onSuccess { fetched = it; error = null }
                .onFailure { if (plan == null) error = it.message }
            if (plan?.isActive != true && plan != null) return@LaunchedEffect
            delay(3_000)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(plan?.displayNumber ?: "Plan") },
                navigationIcon = {
                    IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "Actions") }
                    DropdownMenu(menu, onDismissRequest = { menu = false }) {
                        val target = plan?.let { PlanChatTarget.from(it) }
                        if (showsChatActions && target != null) {
                            DropdownMenuItem(text = { Text(target.buttonTitle) }, onClick = {
                                menu = false
                                val session = store.session(target.sessionId, target.title)
                                session.sendAfterLoad = target.proceedMessage
                                nav.navigate("conversation/${target.sessionId}")
                            })
                        }
                        if (plan?.isCancellable == true) {
                            DropdownMenuItem(text = { Text("Mark as unplanned") }, onClick = {
                                menu = false
                                scope.launch { plans.markUnplanned(plan) }
                            })
                        }
                    }
                },
            )
        },
        bottomBar = {
            plan?.let { ActionBar(it, showsChatActions, nav) }
        },
    ) { padding ->
        when {
            plan != null -> Column(
                Modifier
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CardSection {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Plan ${plan.displayNumber}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        StatusBadge(plan.status)
                    }
                    Text(plan.title.ifEmpty { "Untitled plan" }, style = MaterialTheme.typography.headlineSmall)
                    if (plan.overview.isNotEmpty()) Text(plan.overview, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (plan.decisions.isNotEmpty()) CardSection {
                    Text("Decisions", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    plan.decisions.forEach { d ->
                        if (d.label.isNotEmpty()) Text(d.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                        Text(d.value, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (plan.steps.isNotEmpty()) CardSection {
                    Text("Steps", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    plan.steps.forEachIndexed { i, step ->
                        Text("${i + 1}. ${step.title}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                        step.description?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        step.jobs.forEach { job ->
                            Text(job.title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 12.dp, top = 4.dp))
                            job.commands.forEach { cmd ->
                                Text(cmd.command, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                if (plan.costSummary != null || plan.costOneTime != null) CardSection {
                    Text("Cost", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    plan.costSummary?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    plan.costOneTime?.let { Text("One-time  $it", style = MaterialTheme.typography.bodySmall) }
                    plan.costMonthly?.let { Text("Monthly  $it", style = MaterialTheme.typography.bodySmall) }
                    plan.costSavings?.let { Text("Savings  $it", style = MaterialTheme.typography.bodySmall) }
                }
                if (plan.riskWorstCase != null || plan.riskMitigations.isNotEmpty()) CardSection {
                    Text("Risk", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
                    plan.riskWorstCase?.let { Text("Worst case  $it", style = MaterialTheme.typography.bodyMedium) }
                    plan.riskMitigations.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                }
                CardSection {
                    Text("Approval", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    val p = plan.approvalProgress
                    if (p != null) {
                        Text("Requester ${if (p.requesterApproved) "✓" else "○"}", style = MaterialTheme.typography.bodySmall)
                        Text("Team ${p.otherApprovals}/${p.minimumOtherApprovals}", style = MaterialTheme.typography.bodySmall)
                    } else {
                        Text("${plan.approvalCount} approval(s) recorded.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            error != null -> Text(error ?: "", modifier = Modifier.padding(padding).padding(24.dp), color = MaterialTheme.colorScheme.error)
            else -> Text("Loading plan…", modifier = Modifier.padding(padding).padding(24.dp))
        }
    }
}

@Composable
private fun ActionBar(plan: Plan, showsChatActions: Boolean, nav: NavHostController) {
    val plans = LocalPlansStore.current
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    val chat = if (showsChatActions) PlanChatTarget.from(plan) else null
    val canApprove = plan.status == "proposed" && plan.isReadyForApproval
    if (!canApprove && (chat == null || plan.status !in setOf("proposed", "approved"))) return
    Surface(tonalElevation = 3.dp) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (canApprove) {
                Button(
                    onClick = { scope.launch { runCatching { plans.approve(plan) } } },
                    modifier = Modifier.weight(1f),
                ) { Text("Approve") }
            }
            if (chat != null) {
                FilledTonalButton(
                    onClick = {
                        val session = store.session(chat.sessionId, chat.title)
                        session.sendAfterLoad = chat.proceedMessage
                        nav.navigate("conversation/${chat.sessionId}")
                    },
                    modifier = Modifier.weight(1f),
                ) { Text(chat.buttonTitle) }
            }
        }
    }
}

@Composable
private fun CardSection(content: @Composable () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = { content() })
    }
}
