package ai.nuphos.android.ui.agent

import android.content.ActivityNotFoundException
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import ai.nuphos.android.data.runtimeHttpsUrl
import ai.nuphos.android.session.RuntimeSetupStore

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RuntimeSetupSheet(store: RuntimeSetupStore, onDismiss: () -> Unit,
    launchBrowser: ((String) -> Unit)? = null) {
    var label by remember { mutableStateOf("") }
    var provider by remember { mutableStateOf("codex") }
    var code by remember { mutableStateOf("") }
    var browserError by remember { mutableStateOf(false) }
    var managing by remember { mutableStateOf(false) }
    val scroll = key(managing) { rememberScrollState() }
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state = store.state
    val selection = store.selection
    DisposableEffect(store, lifecycle) {
        store.open()
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) store.setForeground(true)
            if (event == Lifecycle.Event.ON_PAUSE) { code = ""; store.setForeground(false) }
        }
        lifecycle.addObserver(observer)
        store.setForeground(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        onDispose {
            code = ""; store.close(); lifecycle.removeObserver(observer)
        }
    }
    LaunchedEffect(state.attempt?.attemptId, state.attempt?.state, state.attemptMismatch, selection.selectedId, selection.selected?.provider, selection.selected?.status, selection.selected?.kind) { code = ""; browserError = false }
    ModalBottomSheet(sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), onDismissRequest = { code = ""; onDismiss() }, properties = ModalBottomSheetProperties(securePolicy = androidx.compose.ui.window.SecureFlagPolicy.SecureOn)) {
        Column(Modifier.fillMaxWidth().verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (managing) "Manage Agents" else "Choose an Agent", style = MaterialTheme.typography.headlineSmall)
            if (!managing) Text("Choose an Agent for new chats. Existing chats keep their current Agent. Provider sign-in may still be required.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (managing) TextButton(onClick = { code = ""; browserError = false; managing = false }) { Text("Back to Agents") }
                else if (store.canAdminister) OutlinedButton(onClick = { code = ""; browserError = false; managing = true }) { Text("Manage Agents") }
                TextButton(onClick = { code = ""; onDismiss() }) { Text("Done") }
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            state.message?.let { Text(it) }
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (selection.reselectionRequired) Text("The selected Agent is unavailable. Select a saved active Agent before starting a new chat.")
            if (!managing) {
                val groups = listOf(
                    "My computers" to selection.catalog.filter { it.kind == "local" },
                    "Cloud and servers" to selection.catalog.filter { it.kind != "local" },
                )
                groups.filter { it.second.isNotEmpty() }.forEach { (title, runtimes) ->
                    Text(title, style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    runtimes.forEach { runtime ->
                        val selected = selection.selectedId == runtime.id
                        val enabled = !state.busy && state.catalogLoaded && runtime.selectable
                        val providerName = when (runtime.provider) {
                            "codex" -> "Codex"
                            "claude-code" -> "Claude Code"
                            else -> runtime.provider
                        }
                        val description = if (selected) "Selected ${runtime.label}" else "Use ${runtime.label}"
                        Surface(
                            onClick = { code = ""; store.select(runtime.id) },
                            enabled = enabled,
                            modifier = Modifier.fillMaxWidth().semantics { contentDescription = description; this.selected = selected; role = Role.RadioButton },
                            shape = RoundedCornerShape(16.dp),
                            color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
                            border = BorderStroke(1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                        ) {
                            Row(Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Icon(if (runtime.kind == "local") Icons.Outlined.Computer else Icons.Outlined.Cloud,
                                    contentDescription = null, modifier = Modifier.size(24.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(runtime.label, style = MaterialTheme.typography.titleMedium,
                                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                                    Text("$providerName · ${if (selected) "Selected" else runtime.status.replaceFirstChar { it.uppercase() }}",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                RadioButton(selected = selected, onClick = null, enabled = enabled)
                            }
                        }
                    }
                }
                if (state.catalogLoaded && selection.catalog.isEmpty()) Text("No saved Agents.")
                OutlinedButton(onClick = { store.refresh() }, enabled = !state.busy) { Text("Refresh Agents") }
            } else {
                selection.selected?.let { selected ->
                    Text("Selected Agent", style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(selected.label, style = MaterialTheme.typography.titleMedium)
                }
                OutlinedButton(onClick = { code = ""; browserError = false; managing = false }) { Text("Change Agent") }
                if (store.canAdminister) {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    Text("Managed Agent", style = MaterialTheme.typography.titleMedium)
                    Text("Creation can allocate resources. Provider sign-in is a separate step.")
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(provider == "codex", onClick = { provider = "codex" }, label = { Text("Codex") })
                        FilterChip(provider == "claude-code", onClick = { provider = "claude-code" }, label = { Text("Claude Code") })
                    }
                    OutlinedTextField(label, { label = it }, label = { Text("Agent label (optional)") }, enabled = !state.busy && !selection.createReview, singleLine = true)
                    Button(onClick = { store.create(provider, label.trim().takeIf { it.isNotEmpty() }) },
                        enabled = !state.busy && !selection.createReview && label.trim().length <= 120) { Text("Create Agent") }
                    if (selection.createReview) {
                        Text("Creation is unconfirmed. Closing does not undo a saved Agent.")
                        OutlinedButton(onClick = store::confirmCreateReviewed, enabled = !state.busy && state.catalogLoaded) { Text("I reviewed saved Agents") }
                    }
                    if (selection.selected?.kind == "managed") {
                        Button(onClick = store::startLogin, enabled = !state.busy && !selection.loginReview) { Text("Start provider sign-in") }
                        if (selection.loginReview) {
                            if (selection.loginRuntimeId != selection.selectedId) Text("Another Agent has an unconfirmed sign-in. Select that Agent and refresh its sign-in before starting another.")
                            val attempt = state.attempt
                            Text("Sign-in: ${attempt?.state ?: "unconfirmed"}")
                            OutlinedButton(onClick = store::refreshLogin, enabled = !state.busy) { Text("Refresh sign-in") }
                            if (attempt?.state == "awaiting_authorization" && attempt.valid(System.currentTimeMillis()) && !state.attemptMismatch && state.loginReconciled) {
                                attempt.userCode?.let { Text("Provider code: $it") }
                                attempt.browserUrl?.let { url ->
                                    OutlinedButton(onClick = {
                                        val currentUrl = store.authorizationUrlFor(attempt.attemptId)
                                        if (currentUrl != null && currentUrl == url && runtimeHttpsUrl(currentUrl)) {
                                            try { if (launchBrowser != null) launchBrowser(url) else CustomTabsIntent.Builder().setShareState(CustomTabsIntent.SHARE_STATE_OFF).build().launchUrl(context, Uri.parse(url)) }
                                            catch (_: ActivityNotFoundException) { browserError = true }
                                        }
                                    }) { Text("Open provider sign-in") }
                                }
                                if (browserError) Text("Could not open the provider browser.")
                                if (attempt.authorizationUrl != null && !attempt.codeSubmitted) {
                                    OutlinedTextField(code, { code = it }, label = { Text("Full code#state") }, singleLine = true,
                                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(), enabled = !state.busy)
                                    Button(onClick = { val submitted = code; code = ""; store.submitCode(submitted) }, enabled = !state.busy && code.isNotEmpty()) { Text("Submit sign-in code") }
                                }
                            }
                            OutlinedButton(onClick = { code = ""; store.cancelLogin() }, enabled = !state.busy && state.loginReconciled && !state.attemptMismatch && attempt?.pending == true && attempt.valid(System.currentTimeMillis())) { Text("Cancel sign-in") }
                            if (attempt != null && !attempt.pending) OutlinedButton(onClick = store::confirmLoginRestart, enabled = !state.busy && state.loginReconciled && !state.attemptMismatch) { Text("Review and allow a new sign-in") }
                        }
                    } else if (selection.selected != null) Text("Provider setup for self-hosted Agents is not available here.")
                } else Text("Only a current workspace administrator can create Agents or manage provider sign-in.")
                Text("Closing this sheet stops local polling. It does not cancel server sign-in.")
                TextButton(onClick = { code = ""; onDismiss() }) { Text("Close") }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
