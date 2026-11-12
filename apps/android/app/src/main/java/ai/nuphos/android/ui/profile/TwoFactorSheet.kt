package ai.nuphos.android.ui.profile

import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.MfaSetup
import ai.nuphos.android.data.MfaStatus
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.MfaCodeDialog
import ai.nuphos.android.ui.MfaCodeForm
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

sealed interface TwoFactorLoad {
    data object Loading : TwoFactorLoad
    data class Ready(val status: MfaStatus) : TwoFactorLoad
    data class Setup(val setup: MfaSetup) : TwoFactorLoad
    /** Shown once, right after turning it on or replacing them. */
    data class Codes(val codes: List<String>) : TwoFactorLoad
    /** Turning it on needs a recent sign-in, so a stolen session cannot. */
    data object SignInAgain : TwoFactorLoad
    data object Failed : TwoFactorLoad
}

private fun Throwable.needsFreshSignIn() =
    this is NuphosApi.Failure.Http && code == 403 && errorCode in setOf("reauth_required", "session_required")

/**
 * Profile → Two-factor authentication: turn it on with an authenticator app,
 * see how many recovery codes are left, replace them, or turn it off. Matches
 * Desktop's `TwoFactorSection` and iOS's `TwoFactorView`. The authenticator is
 * usually on this same phone, so setup opens it with the otpauth:// link (or
 * the key is typed in) rather than showing a QR code.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TwoFactorSheet(onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    val token = auth.token ?: return
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    val clipboard = LocalClipboardManager.current
    var load by remember(token) { mutableStateOf<TwoFactorLoad>(TwoFactorLoad.Loading) }
    var confirming by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    suspend fun refresh() {
        load = try { TwoFactorLoad.Ready(AccountApi(token).mfaStatus()) }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { if (e.needsFreshSignIn()) TwoFactorLoad.SignInAgain else TwoFactorLoad.Failed }
    }
    LaunchedEffect(token) { refresh() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Two-factor authentication", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Ask for a code from an authenticator app each time you sign in, so a stolen password or email is not enough.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when (val current = load) {
                TwoFactorLoad.Loading -> CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally).padding(16.dp))
                TwoFactorLoad.Failed -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Couldn’t load two-factor authentication.", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Retry") }
                }
                TwoFactorLoad.SignInAgain -> Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Sign in again to turn on two-factor authentication.", style = MaterialTheme.typography.titleSmall)
                        Text("For your security, this needs a sign-in from the last 10 minutes.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(onClick = { onDismiss(); auth.signOut() }, modifier = Modifier.padding(top = 6.dp)) {
                            Text("Sign out and sign in again")
                        }
                    }
                }
                is TwoFactorLoad.Ready -> Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (current.status.enabled) "On" else "Off", style = MaterialTheme.typography.titleMedium)
                        if (current.status.enabled) {
                            Text("${current.status.recoveryCodesRemaining} recovery codes left",
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { confirming = "codes" }) { Text("New recovery codes") }
                                OutlinedButton(onClick = { confirming = "disable" }) { Text("Turn off") }
                            }
                        } else {
                            Button(onClick = {
                                notice = null
                                scope.launch {
                                    try { load = TwoFactorLoad.Setup(AccountApi(token).startMfaSetup()) }
                                    catch (e: CancellationException) { throw e }
                                    catch (e: Exception) {
                                        if (e.needsFreshSignIn()) load = TwoFactorLoad.SignInAgain else notice = e.message
                                    }
                                }
                            }) { Text("Turn on") }
                        }
                    }
                }
                is TwoFactorLoad.Setup -> {
                    Text("1. Add Nuphos to your authenticator app", style = MaterialTheme.typography.titleSmall)
                    OutlinedButton(onClick = { runCatching { uri.openUri(current.setup.otpauthUrl) } }) {
                        Text("Open in authenticator app")
                    }
                    Text("Or enter this key:", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    SelectionContainer {
                        Text(current.setup.secret.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace)
                    }
                    Text("2. Enter the 6-digit code it shows", style = MaterialTheme.typography.titleSmall)
                    MfaCodeForm("Turn on", onSubmit = { code ->
                        load = TwoFactorLoad.Codes(AccountApi(token).confirmMfaSetup(code))
                    })
                    TextButton(onClick = { scope.launch { refresh() } }) { Text("Cancel") }
                }
                is TwoFactorLoad.Codes -> Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Save your recovery codes", style = MaterialTheme.typography.titleSmall)
                        Text("If you lose your authenticator, each code signs you in once. They are shown only now.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        SelectionContainer {
                            Text(current.codes.joinToString("\n"), fontFamily = FontFamily.Monospace)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { clipboard.setText(AnnotatedString(current.codes.joinToString("\n"))) }) {
                                Text("Copy codes")
                            }
                            Button(onClick = { scope.launch { refresh() } }) { Text("I saved them") }
                        }
                    }
                }
            }
            notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(8.dp))
        }
    }
    confirming?.let { action ->
        val disable = action == "disable"
        MfaCodeDialog(
            title = if (disable) "Turn off two-factor authentication" else "Replace your recovery codes",
            text = if (disable) "Sign-in will no longer ask for a code. Enter one to confirm."
                else "Your current recovery codes will stop working. Enter a code to confirm.",
            submitLabel = if (disable) "Turn off" else "Replace codes",
            onSubmit = { code ->
                if (disable) {
                    AccountApi(token).disableMfa(code)
                    confirming = null
                    refresh()
                } else {
                    val codes = AccountApi(token).newRecoveryCodes(code)
                    confirming = null
                    load = TwoFactorLoad.Codes(codes)
                }
            },
            onDismiss = { confirming = null },
        )
    }
}
