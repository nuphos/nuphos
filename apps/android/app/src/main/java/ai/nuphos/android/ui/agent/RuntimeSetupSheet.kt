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
    launchBrowser: ((String) -> Unit)? = null,
    quotas: Map<String, ai.nuphos.android.data.RuntimeQuota> = emptyMap(),
    initialManaging: Boolean = false, initialRuntimeId: String? = null, devices: List<ai.nuphos.android.data.RuntimeDevice> = emptyList()) {
    var label by remember { mutableStateOf("") }
    var provider by remember { mutableStateOf("codex") }
    var code by remember { mutableStateOf("") }
    var browserError by remember { mutableStateOf(false) }
    var managing by remember(store) { mutableStateOf(initialManaging) }
    var detailId by remember(store) { mutableStateOf<String?>(null) }
    val initialCatalogRevision = remember(store) { store.state.catalogRevision }
    var pendingInitial by remember(store) { mutableStateOf(initialRuntimeId) }
    val detail = remember(store, detailId) { detailId?.let(store::detail) }
    DisposableEffect(detail) { onDispose { detail?.close() } }
    val scroll = key(managing, detailId) { rememberScrollState() }
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state = store.state
    val selection = store.selection
    LaunchedEffect(state.catalogLoaded, state.catalogRevision) {
        if (state.catalogLoaded && state.catalogRevision > initialCatalogRevision && pendingInitial != null) { detailId = pendingInitial; pendingInitial = null }
    }
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
    LaunchedEffect(store.signInRuntime?.id, state.attempt?.attemptId, state.attempt?.state, state.attemptMismatch, selection.selectedId, selection.selected?.provider, selection.selected?.status, selection.selected?.kind) { code = ""; browserError = false }
    ModalBottomSheet(containerColor = MaterialTheme.colorScheme.background, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), onDismissRequest = { code = ""; onDismiss() }, properties = ModalBottomSheetProperties(securePolicy = androidx.compose.ui.window.SecureFlagPolicy.SecureOn)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 720.dp).fillMaxHeight()) {
            RuntimePickerHeader(title = if (detail != null) "Runtime details" else if (managing) "Manage runtimes" else "Choose runtime", onClose = { code = ""; onDismiss() })
            HorizontalDivider()
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (detail != null) {
                RuntimeDetailPage(detail, quotas[detail.runtimeId], onBack = { detailId = null }, onSignIn = {
                    if (store.focusSignIn(detail.runtimeId)) { detailId = null; managing = true }
                })
            } else {
                if (!managing) Text("For new agents. Existing agents keep their current runtime.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (managing) TextButton(onClick = { code = ""; browserError = false; store.clearSignInFocus(); managing = false }) { Text("Back to runtimes") }

                }
                state.error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                    if (managing && !state.catalogLoaded) TextButton(onClick = store::refresh, enabled = !state.busy) {
                        Text("Retry runtime list")
                    }
                }
                state.message?.let { Text(it) }
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (selection.reselectionRequired) Text("The selected runtime is unavailable. Select a saved active runtime before starting a new agent.")
                if (!managing) {
                    val ready = selection.catalog.filter { it.selectable && it.local?.online != false && quotas[it.id]?.needsSignIn != true }
                    RuntimeChoiceList(ready, selection.selectedId, quotas,
                        enabled = !state.busy && state.catalogLoaded, devices = devices,
                        onDetail = { runtime -> detailId = runtime.id },
                        onSelect = { runtime -> code = ""; store.select(runtime.id); if (store.selection.selectedId == runtime.id && store.selection.valid) onDismiss() })
                    if (state.catalogLoaded && ready.isEmpty()) Text("No available runtimes.")
                    TextButton(onClick = { code = ""; browserError = false; managing = true }) { Text("Manage computers and runtimes") }
                    OutlinedButton(onClick = { store.refresh() }, enabled = !state.busy) { Text("Refresh runtimes") }
                } else {
                    store.signInRuntime?.let { selected ->
                        Text("Runtime sign-in", style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(selected.label, style = MaterialTheme.typography.titleMedium)
                    }
                    OutlinedButton(onClick = { code = ""; browserError = false; store.clearSignInFocus(); managing = false }) { Text("Change runtime") }
                    if (store.canAdminister) {
                        HorizontalDivider(Modifier.padding(vertical = 8.dp))
                        Text("Managed runtime", style = MaterialTheme.typography.titleMedium)
                        Text("Creation can allocate resources. Provider sign-in is a separate step.")
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(provider == "codex", onClick = { provider = "codex" }, label = { Text("Codex") })
                            FilterChip(provider == "claude-code", onClick = { provider = "claude-code" }, label = { Text("Claude Code") })
                        }
                        OutlinedTextField(label, { label = it }, label = { Text("Runtime label (optional)") }, enabled = !state.busy && !selection.createReview, singleLine = true)
                        Button(onClick = { store.create(provider, label.trim().takeIf { it.isNotEmpty() }) },
                            enabled = !state.busy && !selection.createReview && label.trim().length <= 120) { Text("Create runtime") }
                        if (selection.createReview) {
                            Text("Creation is unconfirmed. Closing does not undo a saved runtime.")
                            OutlinedButton(onClick = store::confirmCreateReviewed, enabled = !state.busy && state.catalogLoaded) { Text("I reviewed saved runtimes") }
                        }
                        if (store.signInRuntime?.kind in setOf("managed", "external")) {
                            Button(onClick = store::startLogin, enabled = !state.busy && !selection.loginReview) { Text("Start provider sign-in") }
                            if (selection.loginReview) {
                                if (selection.loginRuntimeId != store.signInRuntime?.id) Text("Another runtime has an unconfirmed sign-in. Select that runtime and refresh its sign-in before starting another.")
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
                        } else if (store.signInRuntime != null) Text("Provider setup for self-hosted runtimes is not available here.")
                    } else Text("Only a current workspace administrator can create runtimes or manage provider sign-in.")
                    Text("Closing this sheet stops local polling. It does not cancel server sign-in.")
                    TextButton(onClick = { code = ""; onDismiss() }) { Text("Close") }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        }
    }
}
