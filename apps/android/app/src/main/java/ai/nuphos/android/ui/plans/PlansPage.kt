package ai.nuphos.android.ui.plans

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Assignment
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import ai.nuphos.android.model.HistoryTime
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.model.Plan
import ai.nuphos.android.session.PlansStore
import ai.nuphos.android.ui.LocalAgentStore
import ai.nuphos.android.ui.LocalPlansStore
import ai.nuphos.android.ui.agent.EmptyState
import ai.nuphos.android.ui.components.NuphosAvatar
import ai.nuphos.android.ui.components.SearchField
import ai.nuphos.android.ui.components.StatusBadge
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun PlansPage(
    searching: Boolean,
    onSearchingChange: (Boolean) -> Unit,
    nav: NavHostController,
) {
    val plans = LocalPlansStore.current
    val store = LocalAgentStore.current
    val scope = rememberCoroutineScope()
    var showPolicy by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(Unit) {
        while (isActive) {
            delay(10_000)
            plans.silentRefresh()
        }
    }
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index }
            .collect { last ->
                if (plans.hasMore && last != null && last >= plans.rows.lastIndex - 2) plans.loadMore()
            }
    }

    Column(Modifier.fillMaxSize()) {
        if (searching) {
            SearchField(plans.search, { plans.search = it }, "Search plans") {
                plans.search = ""
                onSearchingChange(false)
            }
        }
        PolicyStrip(onConfigure = { showPolicy = true })
        when {
            plans.phase == PlansStore.Phase.Loading || plans.phase == PlansStore.Phase.Idle -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            }
            plans.phase == PlansStore.Phase.Failed -> EmptyState(
                Icons.Outlined.WifiOff, "Couldn't load plans", plans.phaseError.orEmpty(), "Try again",
            ) { scope.launch { plans.reload() } }
            plans.rows.isEmpty() && plans.plans.isNotEmpty() && plans.search.isNotBlank() -> EmptyState(
                Icons.Outlined.Assignment, "No matching plans", "Try a different title or plan number.", "Clear search",
            ) { plans.search = "" }
            plans.rows.isEmpty() && plans.plans.isEmpty() -> EmptyState(
                Icons.Outlined.Assignment,
                "Plans",
                "When you ask the agent to do something that needs confirmation, it drafts a plan here for the team to review and approve.",
                "Ask the agent to plan a change",
            ) {
                val session = store.newSession() ?: return@EmptyState
                store.pendingPrompt = ai.nuphos.android.model.ComposerSubmission(
                    "Help me plan an infrastructure change — ask me what I want to do, then draft a plan for the team to review.",
                )
                nav.navigate("conversation/${session.sessionId}?fresh=true")
            }
            plans.rows.isEmpty() -> EmptyState(
                Icons.Outlined.Assignment, "No plans to show", "Dismissed plans are hidden.", "Show dismissed",
            ) { plans.showDismissed = true }
            else -> LazyColumn(
                state = listState,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(plans.rows, key = { it.id }) { plan ->
                    PlanRow(plan) { nav.navigate("plan/${plan.id}") }
                }
            }
        }
    }
    if (showPolicy) PlanApprovalPolicySheet(onDismiss = { showPolicy = false })
}

@Composable
private fun PolicyStrip(onConfigure: () -> Unit) {
    val plans = LocalPlansStore.current
    val store = LocalAgentStore.current
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.secondaryContainer,
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f).padding(horizontal = 10.dp)) {
                Text("Plan approval", style = MaterialTheme.typography.titleSmall)
                Text(plans.approvalPolicy?.summary ?: if (plans.phase == PlansStore.Phase.Loaded) "Not available" else "Loading…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
            }
            if (store.selectedTeam?.isAdministrator == true && plans.approvalPolicy != null) {
                FilledTonalButton(onClick = onConfigure) { Text("Configure") }
            }
        }
    }
}

@Composable
private fun PlanRow(plan: Plan, onClick: () -> Unit) {
    val plans = LocalPlansStore.current
    val creator = plans.member(plan.createdBy)
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        shape = MaterialTheme.shapes.large,
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            NuphosAvatar(creator?.asUser() ?: NuphosUser(id = plan.createdBy, name = "?"), size = 40.dp)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(plan.title.ifEmpty { "Untitled plan" }, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = buildList {
                    add(plan.displayNumber)
                    if (plan.progress.total > 0) add("${plan.progress.done}/${plan.progress.total} steps")
                    creator?.let { add(it.displayName) }
                    plan.createdAt?.let { add(HistoryTime.format(it)) }
                }.joinToString(" · ")
                Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            StatusBadge(plan.status)
        }
    }
}
