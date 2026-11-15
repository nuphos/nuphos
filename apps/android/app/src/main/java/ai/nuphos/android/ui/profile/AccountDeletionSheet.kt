package ai.nuphos.android.ui.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountDeletionSheet(onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    val token = auth.token ?: return
    val user = auth.user ?: return
    val generation = auth.generation
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    val checkFailed = stringResource(R.string.profile_deletion_check_failed)
    val sendCodeFailed = stringResource(R.string.profile_deletion_send_code_failed)
    val noReceipt = stringResource(R.string.profile_deletion_no_receipt)
    val unconfirmed = stringResource(R.string.profile_deletion_unconfirmed)
    val notFound = stringResource(R.string.profile_deletion_not_found)
    var loaded by remember(token, generation) { mutableStateOf(false) }
    var busy by remember(token, generation) { mutableStateOf(false) }
    var status by remember(token, generation) { mutableStateOf<String?>(null) }
    var requestedAt by remember(token, generation) { mutableStateOf("") }
    var dueAt by remember(token, generation) { mutableStateOf("") }
    var error by remember(token, generation) { mutableStateOf<String?>(null) }
    var passwordMode by remember(token, generation) { mutableStateOf(false) }
    var confirmation by remember(token, generation) { mutableStateOf("") }
    var code by remember(token, generation) { mutableStateOf("") }
    var password by remember(token, generation) { mutableStateOf("") }
    var sent by remember(token, generation) { mutableStateOf(false) }
    fun current() = auth.token == token && auth.generation == generation && auth.user?.id == user.id
    fun clearSecrets() { code = ""; password = "" }
    suspend fun load(): Boolean {
        if (!current()) return false
        loaded = false
        return try {
            val response = AccountApi(token).deletion()
            if (!current()) false else {
                status = response.request?.status
                requestedAt = response.request?.requestedAt.orEmpty()
                dueAt = response.request?.dueAt.orEmpty()
                loaded = true
                true
            }
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            if (current()) {
                error = checkFailed
                if (e is NuphosApi.Failure.Unauthorized) auth.signOut(e.message)
            }
            false
        }
    }
    LaunchedEffect(token, generation) { busy = true; load(); if (current()) busy = false }
    DisposableEffect(token, generation) { onDispose { clearSecrets() } }
    ModalBottomSheet(onDismissRequest = { clearSecrets(); onDismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(stringResource(R.string.profile_deletion_title), style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.profile_deletion_body))
            Text(stringResource(R.string.profile_deletion_request_note))
            TextButton(onClick = { uri.openUri("https://nuphos.ai/privacy") }) { Text(stringResource(R.string.profile_privacy_policy)) }
            if (status != null) {
                Text(stringResource(R.string.profile_deletion_received), style = MaterialTheme.typography.titleMedium)
                Text(stringResource(R.string.profile_deletion_status, when (status) { "requested" -> stringResource(R.string.profile_deletion_status_requested); "in_progress" -> stringResource(R.string.profile_deletion_status_in_progress); "completed" -> stringResource(R.string.profile_deletion_status_completed); else -> stringResource(R.string.profile_deletion_status_unknown, status.orEmpty()) }))
                Text(stringResource(R.string.profile_deletion_requested_at, requestedAt))
                Text(stringResource(R.string.profile_deletion_complete_by, dueAt))
                Text(stringResource(R.string.profile_deletion_saved))
            } else {
                if (passwordMode) {
                    OutlinedTextField(password, { password = it; error = null }, label = { Text(stringResource(R.string.profile_deletion_password_label)) }, visualTransformation = PasswordVisualTransformation(), enabled = !busy && loaded, modifier = Modifier.fillMaxWidth())
                } else {
                    Text(stringResource(R.string.profile_deletion_send_code_to, user.email))
                    TextButton(enabled = loaded && !busy && !sent, onClick = {
                        busy = true; error = null
                        scope.launch {
                            try {
                                if (!current()) return@launch
                                AccountApi(token).requestCode(user.email)
                                if (current()) sent = true
                            } catch (e: CancellationException) { throw e
                            } catch (e: Exception) { if (current()) error = sendCodeFailed }
                            finally { if (current()) busy = false }
                        }
                    }) { Text(if (sent) stringResource(R.string.profile_deletion_code_sent) else stringResource(R.string.profile_deletion_send_code)) }
                    OutlinedTextField(code, { code = it; error = null }, label = { Text(stringResource(R.string.profile_deletion_code_label)) }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth())
                }
                TextButton(enabled = !busy, onClick = { passwordMode = !passwordMode; clearSecrets(); error = null }) { Text(if (passwordMode) stringResource(R.string.profile_deletion_confirm_with_code) else stringResource(R.string.profile_deletion_confirm_with_password)) }
                OutlinedTextField(confirmation, { confirmation = it; error = null }, label = { Text(stringResource(R.string.profile_deletion_type_delete)) }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth())
                Button(enabled = loaded && !busy && confirmation == "DELETE" && (if (passwordMode) password.length >= 12 else code.length == 6), onClick = {
                    busy = true; error = null
                    scope.launch {
                        try {
                            if (!current()) return@launch
                            val response = AccountApi(token).requestDeletion(confirmation, password = password.takeIf { passwordMode }, code = code.takeIf { !passwordMode })
                            if (current()) {
                                clearSecrets()
                                status = response.request?.status
                                requestedAt = response.request?.requestedAt.orEmpty()
                                dueAt = response.request?.dueAt.orEmpty()
                                if (status == null) {
                                    loaded = false
                                    error = noReceipt
                                }
                            }
                        } catch (e: CancellationException) { throw e
                        } catch (e: Exception) {
                            if (current()) {
                                clearSecrets()
                                error = unconfirmed
                                if (load()) error = if (status == null) notFound else null
                            }
                        } finally { if (current()) busy = false }
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_deletion_submit)) }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (busy) CircularProgressIndicator()
            TextButton(enabled = !busy, onClick = { busy = true; error = null; scope.launch { load(); if (current()) busy = false } }) { Text(stringResource(R.string.profile_deletion_refresh)) }
            TextButton(onClick = { clearSecrets(); onDismiss() }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_close)) }
        }
    }
}
