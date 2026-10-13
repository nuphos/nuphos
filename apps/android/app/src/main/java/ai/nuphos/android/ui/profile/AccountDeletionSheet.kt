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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountDeletionSheet(onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    val token = auth.token ?: return
    val user = auth.user ?: return
    val generation = auth.generation
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
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
                error = "We could not check your deletion request. Retry the status check before submitting."
                if (e is NuphosApi.Failure.Unauthorized) auth.signOut(e.message)
            }
            false
        }
    }
    LaunchedEffect(token, generation) { busy = true; load(); if (current()) busy = false }
    DisposableEffect(token, generation) { onDispose { clearSecrets() } }
    ModalBottomSheet(onDismissRequest = { clearSecrets(); onDismiss() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Delete account", style = MaterialTheme.typography.headlineSmall)
            Text("We will permanently delete your account and associated personal data within 30 days. Our team will coordinate workspace ownership and shared data. Records required by law and data jointly held by your team may be retained.")
            Text("This submits a request. It does not instantly erase your account. You can continue using your account while it is processed. Signing in again does not cancel the request.")
            TextButton(onClick = { uri.openUri("https://nuphos.ai/privacy") }) { Text("Privacy policy") }
            if (status != null) {
                Text("Request received", style = MaterialTheme.typography.titleMedium)
                Text("Status: " + when (status) { "requested" -> "Requested"; "in_progress" -> "In progress"; "completed" -> "Completed"; else -> "Unknown status (${status})" })
                Text("Requested at: $requestedAt")
                Text("Complete by: $dueAt")
                Text("Your request has been saved. You do not need to contact support to start deletion.")
            } else {
                if (passwordMode) {
                    OutlinedTextField(password, { password = it; error = null }, label = { Text("Account password") }, visualTransformation = PasswordVisualTransformation(), enabled = !busy && loaded, modifier = Modifier.fillMaxWidth())
                } else {
                    Text("Send a verification code to ${user.email}.")
                    TextButton(enabled = loaded && !busy && !sent, onClick = {
                        busy = true; error = null
                        scope.launch {
                            try {
                                if (!current()) return@launch
                                AccountApi(token).requestCode(user.email)
                                if (current()) sent = true
                            } catch (e: CancellationException) { throw e
                            } catch (e: Exception) { if (current()) error = "We could not send the code. Please try again." }
                            finally { if (current()) busy = false }
                        }
                    }) { Text(if (sent) "Code sent — check your inbox" else "Send verification code") }
                    OutlinedTextField(code, { code = it; error = null }, label = { Text("Verification code") }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth())
                }
                TextButton(enabled = !busy, onClick = { passwordMode = !passwordMode; clearSecrets(); error = null }) { Text(if (passwordMode) "Confirm with an email code" else "Confirm with my password") }
                OutlinedTextField(confirmation, { confirmation = it; error = null }, label = { Text("Type DELETE") }, enabled = !busy && loaded, modifier = Modifier.fillMaxWidth())
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
                                    error = "The server did not return a receipt. Check request status before trying again."
                                }
                            }
                        } catch (e: CancellationException) { throw e
                        } catch (e: Exception) {
                            if (current()) {
                                clearSecrets()
                                error = "Submission was not confirmed. Checking request status…"
                                if (load()) error = if (status == null) "No request was found. Enter your verification again to submit manually." else null
                            }
                        } finally { if (current()) busy = false }
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text("Request permanent deletion") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (busy) CircularProgressIndicator()
            TextButton(enabled = !busy, onClick = { busy = true; error = null; scope.launch { load(); if (current()) busy = false } }) { Text("Refresh request status") }
            TextButton(onClick = { clearSecrets(); onDismiss() }, modifier = Modifier.fillMaxWidth()) { Text("Close") }
        }
    }
}
