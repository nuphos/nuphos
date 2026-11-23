package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
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
    initialManaging: Boolean = false, initialRuntimeId: String? = null, initialSignInRuntimeId: String? = null, inventoryMode: Boolean = false, devices: List<ai.nuphos.android.data.RuntimeDevice> = emptyList()) {
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
            RuntimePickerHeader(title = stringResource(if (detail != null) R.string.agent_runtime_details else if (initialSignInRuntimeId != null) R.string.agent_sign_in else if (inventoryMode && store.signInRuntime != null) R.string.agent_sign_in else if (managing) R.string.agent_manage_runtimes else R.string.agent_choose_runtime), onClose = { code = ""; onDismiss() })
            HorizontalDivider()
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (detail != null) {
                RuntimeDetailPage(detail, quotas[detail.runtimeId], onBack = { if (inventoryMode) onDismiss() else detailId = null }, onSignIn = {
                    if (store.focusSignIn(detail.runtimeId)) { detailId = null; managing = true }
                })
            } else {
                if (!managing) Text(stringResource(R.string.agent_for_new_tasks),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (managing && !inventoryMode && initialSignInRuntimeId == null) TextButton(onClick = { code = ""; browserError = false; store.clearSignInFocus(); managing = false }) { Text(stringResource(R.string.agent_back_to_runtimes)) }

                }
                state.error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error)
                    if (managing && !state.catalogLoaded) TextButton(onClick = store::refresh, enabled = !state.busy) {
                        Text(stringResource(R.string.agent_retry_runtime_list))
                    }
                }
                state.message?.let { Text(it) }
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (selection.reselectionRequired) Text(stringResource(R.string.agent_reselect_runtime))
                if (!managing) {
                    val ready = selection.catalog.filter { it.selectable && it.local?.online != false && quotas[it.id]?.needsSignIn != true }
                    RuntimeChoiceList(ready, selection.selectedId, quotas,
                        enabled = !state.busy && state.catalogLoaded, devices = devices,
                        onDetail = { runtime -> detailId = runtime.id },
                        onSelect = { runtime -> code = ""; store.select(runtime.id); if (store.selection.selectedId == runtime.id && store.selection.valid) onDismiss() })
                    if (state.catalogLoaded && ready.isEmpty()) Text(stringResource(R.string.agent_no_available_runtimes))
                    TextButton(onClick = { code = ""; browserError = false; managing = true }) { Text(stringResource(R.string.agent_manage_computers_runtimes)) }
                    OutlinedButton(onClick = { store.refresh() }, enabled = !state.busy) { Text(stringResource(R.string.agent_refresh_runtimes)) }
                } else {
                    store.signInRuntime?.let { selected ->
                        Text(stringResource(R.string.agent_runtime_sign_in), style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(selected.label, style = MaterialTheme.typography.titleMedium)
                    }
                    if (!inventoryMode && initialSignInRuntimeId == null) OutlinedButton(onClick = { code = ""; browserError = false; store.clearSignInFocus(); managing = false }) { Text(stringResource(R.string.agent_change_runtime)) }
                    if (store.canSignIn) {
                        if (store.signInRuntime != null) {
                            Button(onClick = store::startLogin, enabled = !state.busy && !selection.loginReview) { Text(stringResource(R.string.agent_start_provider_sign_in)) }
                            if (selection.loginReview) {
                                if (selection.loginRuntimeId != store.signInRuntime?.id) Text(stringResource(R.string.agent_other_unconfirmed_sign_in))
                                val attempt = state.attempt
                                Text(stringResource(R.string.agent_sign_in_state, attempt?.state ?: stringResource(R.string.agent_unconfirmed)))
                                OutlinedButton(onClick = store::refreshLogin, enabled = !state.busy) { Text(stringResource(R.string.agent_refresh_sign_in)) }
                                if (attempt?.state == "awaiting_authorization" && attempt.valid(System.currentTimeMillis()) && !state.attemptMismatch && state.loginReconciled) {
                                    val step = attempt.step
                                    if (attempt.codeSubmitted) Text(stringResource(R.string.agent_continuing_sign_in))
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
                                    attempt.userCode?.let { Text(stringResource(R.string.agent_provider_code, it)) }
                                    attempt.browserUrl?.let { url ->
                                        OutlinedButton(onClick = {
                                            val currentUrl = store.authorizationUrlFor(attempt.attemptId)
                                            if (currentUrl != null && currentUrl == url && runtimeHttpsUrl(currentUrl)) {
                                                try { if (launchBrowser != null) launchBrowser(url) else CustomTabsIntent.Builder().setShareState(CustomTabsIntent.SHARE_STATE_OFF).build().launchUrl(context, Uri.parse(url)) }
                                                catch (_: ActivityNotFoundException) { browserError = true }
                                            }
                                        }) { Text(stringResource(R.string.agent_open_provider_sign_in)) }
                                    }
                                    if (browserError) Text(stringResource(R.string.agent_browser_error))
                                    if (!attempt.codeSubmitted && (step?.kind == "input" || step?.kind == "browser" && step.paste != null || step == null && attempt.authorizationUrl != null)) {
                                        OutlinedTextField(code, { code = it }, label = { Text(step?.message ?: stringResource(if (step?.paste == "address") R.string.agent_redirect_address else R.string.agent_authorization_code)) },
                                            placeholder = { step?.placeholder?.let { Text(it) } }, singleLine = true,
                                            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(autoCorrectEnabled = false,
                                                capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.None,
                                                keyboardType = if (step?.secret == true) androidx.compose.ui.text.input.KeyboardType.Password else androidx.compose.ui.text.input.KeyboardType.Text),
                                            visualTransformation = if (step?.secret == false) androidx.compose.ui.text.input.VisualTransformation.None else androidx.compose.ui.text.input.PasswordVisualTransformation(), enabled = !state.busy)
                                        Button(onClick = { val submitted = code; code = ""; store.submitCode(submitted) }, enabled = !state.busy && ai.nuphos.android.data.validRuntimeAnswer(attempt, code)) { Text(stringResource(if (step == null) R.string.agent_submit_sign_in_code else R.string.agent_continue)) }
                                    }
                                }
                                OutlinedButton(onClick = { code = ""; store.cancelLogin() }, enabled = !state.busy && state.loginReconciled && !state.attemptMismatch && attempt?.pending == true && attempt.valid(System.currentTimeMillis())) { Text(stringResource(R.string.agent_cancel_sign_in)) }
                                if (attempt != null && !attempt.pending) OutlinedButton(onClick = store::confirmLoginRestart, enabled = !state.busy && state.loginReconciled && !state.attemptMismatch) { Text(stringResource(R.string.agent_review_new_sign_in)) }
                            }
                        } else if (store.signInRuntime != null) Text(stringResource(R.string.agent_self_hosted_unavailable))
                    } else if (!state.busy && initialSignInRuntimeId != null) Text(stringResource(R.string.agent_sign_in_unavailable))
                    else if (!store.canAdminister) Text(stringResource(R.string.agent_admins_only_create))
                    Text(stringResource(R.string.agent_closing_stops_polling))
                    TextButton(onClick = { code = ""; onDismiss() }) { Text(stringResource(R.string.agent_close)) }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
        }
    }
}
