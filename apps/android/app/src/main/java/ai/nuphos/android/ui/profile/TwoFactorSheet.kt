package ai.nuphos.android.ui.profile

import android.content.Context
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.MfaSetup
import ai.nuphos.android.data.MfaStatus
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.PasskeyInfo
import ai.nuphos.android.data.Passkeys
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import ai.nuphos.android.R

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

/** Set before the sign-out this sheet asks for, so the next sign-in opens it once more. */
object TwoFactorResume {
    private const val KEY = "nuphos.resumeTwoFactor"
    private fun prefs(context: Context) = context.getSharedPreferences("nuphos.prefs", Context.MODE_PRIVATE)
    fun request(context: Context) = prefs(context).edit().putBoolean(KEY, true).apply()
    fun pending(context: Context) = prefs(context).getBoolean(KEY, false)
    fun take(context: Context) = pending(context).also { if (it) prefs(context).edit().remove(KEY).apply() }
}

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
    val context = LocalContext.current
    val token = auth.token ?: return
    val scope = rememberCoroutineScope()
    val uri = LocalUriHandler.current
    val clipboard = LocalClipboardManager.current
    var load by remember(token) { mutableStateOf<TwoFactorLoad>(TwoFactorLoad.Loading) }
    var confirming by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var removing by remember { mutableStateOf<PasskeyInfo?>(null) }
    val activity = androidx.activity.compose.LocalActivity.current
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
            Text(stringResource(R.string.profile_two_factor), style = MaterialTheme.typography.headlineSmall)
            Text(
                stringResource(R.string.profile_two_factor_intro),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when (val current = load) {
                TwoFactorLoad.Loading -> CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally).padding(16.dp))
                TwoFactorLoad.Failed -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.profile_two_factor_load_failed), Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = { scope.launch { refresh() } }) { Text(stringResource(R.string.profile_retry)) }
                }
                TwoFactorLoad.SignInAgain -> Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.profile_two_factor_sign_in_again_title), style = MaterialTheme.typography.titleSmall)
                        Text(stringResource(R.string.profile_two_factor_sign_in_again_body),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Button(onClick = { TwoFactorResume.request(context); onDismiss(); auth.signOut() }, modifier = Modifier.padding(top = 6.dp)) {
                            Text(stringResource(R.string.profile_sign_out_and_sign_in_again))
                        }
                    }
                }
                is TwoFactorLoad.Ready -> Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (current.status.enabled) stringResource(R.string.profile_two_factor_on) else stringResource(R.string.profile_two_factor_off), style = MaterialTheme.typography.titleMedium)
                        if (current.status.enabled) {
                            Text(pluralStringResource(R.plurals.profile_two_factor_recovery_codes_left, current.status.recoveryCodesRemaining, current.status.recoveryCodesRemaining),
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { confirming = "codes" }) { Text(stringResource(R.string.profile_two_factor_new_recovery_codes)) }
                                OutlinedButton(onClick = { confirming = "disable" }) { Text(stringResource(R.string.profile_two_factor_turn_off)) }
                            }
                            current.status.passkeys.forEach { passkey ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(passkey.name, Modifier.weight(1f))
                                    TextButton(onClick = { removing = passkey }) {
                                        Text(stringResource(R.string.profile_two_factor_remove), color = MaterialTheme.colorScheme.error)
                                    }
                                }
                            }
                            if (activity != null) {
                                // A session without a recent code is asked for one first (data/StepUp.kt).
                                OutlinedButton(onClick = {
                                    notice = null
                                    scope.launch {
                                        try {
                                            val api = AccountApi(token)
                                            api.addPasskey(Passkeys.create(activity, api.passkeyRegistrationOptions()), android.os.Build.MODEL)
                                            refresh()
                                        } catch (e: CancellationException) { throw e
                                        } catch (_: androidx.credentials.exceptions.CreateCredentialCancellationException) {
                                        } catch (e: Exception) { notice = e.message }
                                    }
                                }) { Text(stringResource(R.string.profile_two_factor_add_passkey)) }
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
                            }) { Text(stringResource(R.string.profile_two_factor_turn_on)) }
                        }
                    }
                }
                is TwoFactorLoad.Setup -> {
                    Text(stringResource(R.string.profile_two_factor_setup_step_add), style = MaterialTheme.typography.titleSmall)
                    OutlinedButton(onClick = { runCatching { uri.openUri(current.setup.otpauthUrl) } }) {
                        Text(stringResource(R.string.profile_two_factor_open_authenticator))
                    }
                    Text(stringResource(R.string.profile_two_factor_enter_key), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    SelectionContainer {
                        Text(current.setup.secret.chunked(4).joinToString(" "), fontFamily = FontFamily.Monospace)
                    }
                    Text(stringResource(R.string.profile_two_factor_setup_step_code), style = MaterialTheme.typography.titleSmall)
                    MfaCodeForm(stringResource(R.string.profile_two_factor_turn_on), onSubmit = { code ->
                        load = TwoFactorLoad.Codes(AccountApi(token).confirmMfaSetup(code))
                    })
                    TextButton(onClick = { scope.launch { refresh() } }) { Text(stringResource(R.string.cancel)) }
                }
                is TwoFactorLoad.Codes -> Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(stringResource(R.string.profile_two_factor_save_codes_title), style = MaterialTheme.typography.titleSmall)
                        Text(stringResource(R.string.profile_two_factor_save_codes_body),
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        SelectionContainer {
                            Text(current.codes.joinToString("\n"), fontFamily = FontFamily.Monospace)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { clipboard.setText(AnnotatedString(current.codes.joinToString("\n"))) }) {
                                Text(stringResource(R.string.profile_two_factor_copy_codes))
                            }
                            Button(onClick = { scope.launch { refresh() } }) { Text(stringResource(R.string.profile_two_factor_codes_saved)) }
                        }
                    }
                }
            }
            notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(8.dp))
        }
    }
    removing?.let { passkey ->
        MfaCodeDialog(
            title = stringResource(R.string.profile_two_factor_remove_passkey_title),
            text = stringResource(R.string.profile_two_factor_remove_passkey_body, passkey.name),
            submitLabel = stringResource(R.string.profile_two_factor_remove),
            onSubmit = { code ->
                AccountApi(token).removePasskey(passkey.id, code)
                removing = null
                refresh()
            },
            onDismiss = { removing = null },
        )
    }
    confirming?.let { action ->
        val disable = action == "disable"
        MfaCodeDialog(
            title = if (disable) stringResource(R.string.profile_two_factor_turn_off_title) else stringResource(R.string.profile_two_factor_replace_codes_title),
            text = if (disable) stringResource(R.string.profile_two_factor_turn_off_body)
                else stringResource(R.string.profile_two_factor_replace_codes_body),
            submitLabel = if (disable) stringResource(R.string.profile_two_factor_turn_off) else stringResource(R.string.profile_two_factor_replace_codes),
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
