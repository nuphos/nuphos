package ai.nuphos.android.ui.plans

import kotlinx.coroutines.CancellationException
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
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
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource

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
    var confirmUnplan by remember { mutableStateOf(false) }
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
                title = { Text(plan?.displayNumber ?: stringResource(R.string.plans_title_fallback)) },
                navigationIcon = {
                    IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = stringResource(R.string.plans_back)) }
                },
                actions = {
                    IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = stringResource(R.string.plans_actions)) }
                    DropdownMenu(menu, onDismissRequest = { menu = false }) {
                        val target = plan?.let { PlanChatTarget.from(it) }
                        if (showsChatActions && target != null) {
                            DropdownMenuItem(text = { Text(target.buttonTitle) }, onClick = {
                                menu = false
                                store.session(target.sessionId, target.title)
                                nav.navigate("conversation/${target.sessionId}")
                            })
                        }
                        if (plan?.isCancellable == true) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.plans_mark_unplanned)) }, onClick = {
                                menu = false
                                confirmUnplan = true
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
                        Text(stringResource(R.string.plans_plan_number, plan.displayNumber), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                        StatusBadge(plan.status)
                    }
                    Text("${pluralStringResource(R.plurals.plans_step_count, plan.steps.size, plan.steps.size)} · ${pluralStringResource(R.plurals.plans_job_count, plan.totalJobs, plan.totalJobs)} · ${pluralStringResource(R.plurals.plans_command_count, plan.totalCommands, plan.totalCommands)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(plan.title.ifEmpty { stringResource(R.string.plans_untitled) }, style = MaterialTheme.typography.titleMedium)
                    if (plan.overview.isNotEmpty()) Text(plan.overview, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (plan.status == "failed" && !plan.executionError.isNullOrBlank()) CardSection {
                    Text(plan.executionError, color = MaterialTheme.colorScheme.error)
                }
                if (plan.status == "proposed" && !plan.isReadyForApproval) CardSection {
                    Text(stringResource(R.string.plans_still_building), style = MaterialTheme.typography.bodySmall)
                }
                if (plan.decisions.isNotEmpty()) CardSection {
                    Text(stringResource(R.string.plans_decisions), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    plan.decisions.forEach { d ->
                        if (d.label.isNotEmpty()) Text(d.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
                        Text(d.value, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (plan.steps.isNotEmpty()) CardSection {
                    Text(stringResource(R.string.plans_steps), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    PlanSteps(plan.steps)
                }
                if (plan.costSummary != null || plan.costOneTime != null || plan.costMonthly != null || plan.costSavings != null) CardSection {
                    Text(stringResource(R.string.plans_cost), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    plan.costSummary?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                    plan.costOneTime?.let { Text(stringResource(R.string.plans_cost_one_time, it), style = MaterialTheme.typography.bodySmall) }
                    plan.costMonthly?.let { Text(stringResource(R.string.plans_cost_monthly, it), style = MaterialTheme.typography.bodySmall) }
                    plan.costSavings?.let { Text(stringResource(R.string.plans_cost_savings, it), style = MaterialTheme.typography.bodySmall) }
                }
                if (plan.riskWorstCase != null || plan.riskMitigations.isNotEmpty()) CardSection {
                    Text(stringResource(R.string.plans_risk), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
                    plan.riskWorstCase?.let { Text(stringResource(R.string.plans_risk_worst_case, it), style = MaterialTheme.typography.bodyMedium) }
                    plan.riskMitigations.forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                }
                CardSection {
                    Text(stringResource(R.string.plans_approval), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    val p = plan.approvalProgress
                    if (p != null) {
                        Text(stringResource(R.string.plans_approval_requester, if (p.requesterApproved) "✓" else "○"), style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(R.string.plans_approval_team, p.otherApprovals, p.minimumOtherApprovals), style = MaterialTheme.typography.bodySmall)
                    } else {
                        Text(pluralStringResource(R.plurals.plans_approvals_recorded, plan.approvalCount, plan.approvalCount), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            error != null -> Text(error ?: "", modifier = Modifier.padding(padding).padding(24.dp), color = MaterialTheme.colorScheme.error)
            else -> Text(stringResource(R.string.plans_loading), modifier = Modifier.padding(padding).padding(24.dp))
        }
    }
    if (confirmUnplan && plan != null) AlertDialog(
        onDismissRequest = { confirmUnplan = false },
        title = { Text(stringResource(R.string.plans_unplan_confirm_title, plan.displayNumber)) },
        text = { Text(stringResource(R.string.plans_unplan_confirm_body)) },
        confirmButton = { TextButton(onClick = { confirmUnplan = false; scope.launch { plans.markUnplanned(plan) } }) { Text(stringResource(R.string.plans_mark_unplanned), color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmUnplan = false }) { Text(stringResource(R.string.cancel)) } },
    )
    plans.actionError?.let { message -> AlertDialog(onDismissRequest = { plans.actionError = null }, title = { Text(stringResource(R.string.plans_error_title)) }, text = { Text(message) }, confirmButton = { TextButton(onClick = { plans.actionError = null }) { Text(stringResource(R.string.plans_ok)) } }) }
}

@Composable
private fun ActionBar(plan: Plan, showsChatActions: Boolean, nav: NavHostController) {
    val plans = LocalPlansStore.current
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    val chat = if (showsChatActions) PlanChatTarget.from(plan) else null
    var busy by remember(plan.id) { mutableStateOf(false) }
    var notice by remember(plan.id) { mutableStateOf<String?>(null) }
    val alreadyRecorded = stringResource(R.string.plans_approval_already_recorded)
    val approveFailed = stringResource(R.string.plans_approve_failed)
    notice?.let { message -> AlertDialog(onDismissRequest = { notice = null }, title = { Text(stringResource(R.string.plans_approval_notice_title)) }, text = { Text(message) }, confirmButton = { TextButton(onClick = { notice = null }) { Text(stringResource(R.string.plans_ok)) } }) }
    val canApprove = plan.status == "proposed" && plan.isReadyForApproval
    if (!canApprove && (chat == null || plan.status !in setOf("proposed", "approved"))) return
    Surface(tonalElevation = 3.dp) {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (canApprove) {
                Button(
                    enabled = !busy,
                    onClick = { if (!busy) { busy = true; scope.launch { try { val updated = plans.approve(plan); if (updated.status != "approved" && updated.approvalCount == plan.approvalCount) notice = alreadyRecorded } catch (e: Exception) { if (e is CancellationException) throw e; notice = e.message ?: approveFailed } finally { busy = false } } } },
                    modifier = Modifier.weight(1f),
                ) { Text(stringResource(R.string.approve)) }
            }
            if (chat != null) {
                FilledTonalButton(
                    enabled = !busy,
                    onClick = {
                        store.session(chat.sessionId, chat.title)
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
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = { content() })
    }
}
