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
    initialManaging: Boolean = false, initialRuntimeId: String? = null, initialSignInRuntimeId: String? = null, newRuntimeOnly: Boolean = false, inventoryMode: Boolean = false, devices: List<ai.nuphos.android.data.RuntimeDevice> = emptyList()) {
    var label by remember { mutableStateOf("") }
    var provider by remember { mutableStateOf("codex") }
    var code by remember { mutableStateOf("") }
    var browserError by remember { mutableStateOf(false) }
    var managing by remember(store) { mutableStateOf(initialManaging) }
    var detailId by remember(store) { mutableStateOf<String?>(null) }
    val initialCatalogRevision = remember(store) { store.state.catalogRevision }
    var pendingInitial by remember(store) { mutableStateOf(initialRuntimeId) }
    var pendingSignIn by remember(store) { mutableStateOf(initialSignInRuntimeId) }
    val detail = remember(store, detailId) { detailId?.let(store::detail) }
    DisposableEffect(detail) { onDispose { detail?.close() } }
    val scroll = key(managing, detailId) { rememberScrollState() }
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val state = store.state
    val selection = store.selection
    LaunchedEffect(state.catalogLoaded, state.catalogRevision, state.busy) {
        if (!state.busy && state.catalogLoaded && state.catalogRevision > initialCatalogRevision && pendingSignIn != null) {
            if (!store.focusSignIn(requireNotNull(pendingSignIn))) browserError = true
            pendingSignIn = null
        }
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
    LaunchedEffect(store.signInRuntime?.id, state.attempt?.attemptId, state.attempt?.state, state.attempt?.step, state.attempt?.codeSubmitted, state.attemptMismatch, selection.selectedId, selection.selected?.provider, selection.selected?.status, selection.selected?.kind) { code = ""; browserError = false }
    ModalBottomSheet(containerColor = MaterialTheme.colorScheme.background, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), onDismissRequest = { code = ""; onDismiss() }, properties = ModalBottomSheetProperties(securePolicy = androidx.compose.ui.window.SecureFlagPolicy.SecureOn)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 720.dp).fillMaxHeight()) {
            RuntimePickerHeader(title = if (detail != null) "Runtime details" else if (initialSignInRuntimeId != null) "Sign in" else if (newRuntimeOnly) (store.signInRuntime?.label ?: "New Runtime") else if (inventoryMode && store.signInRuntime != null) "Sign in" else if (managing) "Manage runtimes" else "Choose runtime", onClose = { code = ""; onDismiss() })
            HorizontalDivider()
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (detail != null) {
                RuntimeDetailPage(detail, quotas[detail.runtimeId], onBack = { if (inventoryMode) onDismiss() else detailId = null }, onSignIn = {
                    if (store.focusSignIn(detail.runtimeId)) { detailId = null; managing = true }
                })
            } else {
                if (!managing) Text("For new agents. Existing agents keep their current runtime.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (managing && !inventoryMode && initialSignInRuntimeId == null) TextButton(onClick = { code = ""; browserError = false; store.clearSignInFocus(); managing = false }) { Text("Back to runtimes") }

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
                    if (!inventoryMode && initialSignInRuntimeId == null) OutlinedButton(onClick = { code = ""; browserError = false; store.clearSignInFocus(); managing = false }) { Text("Change runtime") }
                    if (store.canAdminister && initialSignInRuntimeId == null && (!inventoryMode || newRuntimeOnly && store.signInRuntime == null)) {
                        HorizontalDivider(Modifier.padding(vertical = 8.dp))
                        Text("Provider", style = MaterialTheme.typography.titleMedium)
                        listOf("claude-code", "codex", "grok", "antigravity", "opencode").forEach { choice ->
                            Surface(onClick = { provider = choice }, enabled = !state.busy && !selection.createReview,
                                color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth().semantics {
                                    role = Role.RadioButton; selected = provider == choice
                                }) {
                                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    ai.nuphos.android.ui.components.RuntimeMark(choice, 24.dp)
                                    Column(Modifier.weight(1f)) {
                                        Text(inventoryProviderName(choice))
                                        Text(when(choice) { "claude-code" -> "Anthropic"; "codex" -> "OpenAI"; "grok" -> "xAI"; "antigravity" -> "Google"; else -> "OpenCode" },
                                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    if (provider == choice) Text("✓")
                                }
                            }
                        }
                        Text("You'll sign in with your own provider account. Your plan's usage limits apply.", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedTextField(label, { label = it }, label = { Text("Runtime label (optional)") }, enabled = !state.busy && !selection.createReview, singleLine = true)
                        Button(onClick = { store.create(provider, label.trim().takeIf { it.isNotEmpty() }) },
                            enabled = !state.busy && !selection.createReview && label.trim().length <= 120) { Text("Create runtime") }
                        if (selection.createReview) {
                            Text("Creation is unconfirmed. Closing does not undo a saved runtime.")
                            OutlinedButton(onClick = store::confirmCreateReviewed, enabled = !state.busy && state.catalogLoaded) { Text("I reviewed saved runtimes") }
                        }
                    }
                    if (store.canSignIn) {
                        if (store.signInRuntime != null) {
                            Button(onClick = store::startLogin, enabled = !state.busy && !selection.loginReview) { Text("Start provider sign-in") }
                            if (selection.loginReview) {
                                if (selection.loginRuntimeId != store.signInRuntime?.id) Text("Another runtime has an unconfirmed sign-in. Select that runtime and refresh its sign-in before starting another.")
                                val attempt = state.attempt
                                Text("Sign-in: ${attempt?.state ?: "unconfirmed"}")
                                OutlinedButton(onClick = store::refreshLogin, enabled = !state.busy) { Text("Refresh sign-in") }
                                if (attempt?.state == "awaiting_authorization" && attempt.valid(System.currentTimeMillis()) && !state.attemptMismatch && state.loginReconciled) {
                                    val step = attempt.step
                                    if (attempt.codeSubmitted) Text("Continuing sign-in…")
                                    else if (step?.kind == "choose") {
                                        step.message?.let { Text(it, style = MaterialTheme.typography.titleSmall) }
                                        step.options.forEach { option ->
                                            OutlinedButton(onClick = { code = ""; store.submitCode(option.value) }, enabled = !state.busy,
                                                modifier = Modifier.fillMaxWidth()) {
                                                Column { Text(option.label); option.hint?.let { Text(it, style = MaterialTheme.typography.bodySmall) } }
                                            }
                                        }
                                    }
                                    step?.instructions?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
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
                                    if (!attempt.codeSubmitted && (step?.kind == "input" || step?.kind == "browser" && step.paste != null || step == null && attempt.authorizationUrl != null)) {
                                        OutlinedTextField(code, { code = it }, label = { Text(step?.message ?: if (step?.paste == "address") "Redirect address" else "Authorization code") },
                                            placeholder = { step?.placeholder?.let { Text(it) } }, singleLine = true,
                                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(autoCorrectEnabled = false,
                                                capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.None,
                                                keyboardType = if (step?.secret == true) androidx.compose.ui.text.input.KeyboardType.Password else androidx.compose.ui.text.input.KeyboardType.Text),
                                            visualTransformation = if (step?.secret == false) androidx.compose.ui.text.input.VisualTransformation.None else androidx.compose.ui.text.input.PasswordVisualTransformation(), enabled = !state.busy)
                                        Button(onClick = { val submitted = code; code = ""; store.submitCode(submitted) }, enabled = !state.busy && ai.nuphos.android.data.validRuntimeAnswer(attempt, code)) { Text(if (step == null) "Submit sign-in code" else "Continue") }
                                    }
                                }
                                OutlinedButton(onClick = { code = ""; store.cancelLogin() }, enabled = !state.busy && state.loginReconciled && !state.attemptMismatch && attempt?.pending == true && attempt.valid(System.currentTimeMillis())) { Text("Cancel sign-in") }
                                if (attempt != null && !attempt.pending) OutlinedButton(onClick = store::confirmLoginRestart, enabled = !state.busy && state.loginReconciled && !state.attemptMismatch) { Text("Review and allow a new sign-in") }
                            }
                        } else if (store.signInRuntime != null) Text("Provider setup for self-hosted runtimes is not available here.")
                    } else if (!state.busy && initialSignInRuntimeId != null) Text("Sign-in is unavailable. Refresh the runtime list and check your computer access.")
                    else if (!store.canAdminister) Text("Only a current workspace administrator can create runtimes.")
                    Text("Closing this sheet stops local polling. It does not cancel server sign-in.")
                    TextButton(onClick = { code = ""; onDismiss() }) { Text("Close") }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        }
    }
}
