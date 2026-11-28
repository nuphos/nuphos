package ai.nuphos.android.ui.profile

import ai.nuphos.android.R
import ai.nuphos.android.data.AgentRuntimeApi
import ai.nuphos.android.data.ComputerSubscriptionsApi
import ai.nuphos.android.data.RuntimeDevice
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ComputerNotificationsSheet(token: String, teamId: String, onDismiss: () -> Unit) {
    val subscriptions = remember(token) { ComputerSubscriptionsApi(token) }
    val runtime = remember(token, teamId) { AgentRuntimeApi(token, teamId) }
    val scope = rememberCoroutineScope()
    var computers by remember(runtime) { mutableStateOf<List<RuntimeDevice>>(emptyList()) }
    var selected by remember(runtime) { mutableStateOf<Set<String>>(emptySet()) }
    var saving by remember(runtime) { mutableStateOf<Set<String>>(emptySet()) }
    var loading by remember(runtime) { mutableStateOf(true) }
    var failed by remember(runtime) { mutableStateOf(false) }
    var loaded by remember(runtime) { mutableStateOf(false) }
    var retry by remember(runtime) { mutableIntStateOf(0) }

    LaunchedEffect(runtime, retry) {
        loading = true
        failed = false
        try {
            computers = runtime.devices(metrics = false).sortedBy { it.label.lowercase() }
            selected = subscriptions.list()
            loaded = true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            failed = true
            loaded = false
        } finally {
            loading = false
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.account_computer_alerts), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.computer_notifications_intro_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.computer_notifications_intro))
            when {
                loading -> CircularProgressIndicator()
                failed && !loaded -> Text(stringResource(R.string.computer_notifications_load_failed))
                loaded && computers.isEmpty() -> Text(stringResource(R.string.computer_notifications_empty))
            }
            computers.forEach { computer ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(computer.label)
                        Text(stringResource(if (computer.online) R.string.computer_notifications_online
                            else R.string.computer_notifications_offline))
                    }
                    Switch(
                        checked = computer.id in selected,
                        enabled = loaded && !loading && computer.id !in saving,
                        modifier = Modifier.testTag("computer-notifications.${computer.id}"),
                        onCheckedChange = { enabled ->
                            saving = saving + computer.id
                            scope.launch {
                                try {
                                    subscriptions.set(computer.id, enabled)
                                    selected = if (enabled) selected + computer.id else selected - computer.id
                                } catch (error: CancellationException) {
                                    throw error
                                } catch (_: Exception) {
                                    failed = true
                                } finally {
                                    saving = saving - computer.id
                                }
                            }
                        },
                    )
                }
            }
            Text(stringResource(R.string.computer_notifications_help))
            if (failed) {
                TextButton(enabled = saving.isEmpty(), onClick = { retry++ }) {
                    Text(stringResource(R.string.try_again), color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
