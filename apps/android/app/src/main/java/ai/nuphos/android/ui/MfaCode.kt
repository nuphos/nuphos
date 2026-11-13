package ai.nuphos.android.ui

import ai.nuphos.android.data.StepUp
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.credentials.exceptions.GetCredentialCancellationException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Asks for a code from the authenticator app, or a recovery code instead. A
 * full six-digit code submits by itself. [onSubmit] throws when the code is
 * refused; its message then shows under the field.
 */
@Composable
fun MfaCodeForm(
    submitLabel: String,
    onSubmit: suspend (String) -> Unit,
    modifier: Modifier = Modifier,
    /** Offered when the account may answer with a passkey instead. */
    passkey: (suspend () -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf("") }
    var recovery by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    val complete = if (recovery) code.isNotBlank() else code.length == 6
    fun send(value: String) {
        if (busy) return
        busy = true
        scope.launch {
            try { onSubmit(value) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message; code = "" }
            finally { busy = false }
        }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(
            value = code,
            onValueChange = { next ->
                error = null
                val value = if (recovery) next else next.filter(Char::isDigit).take(6)
                val completed = !recovery && value.length == 6 && code.length != 6
                code = value
                if (completed) send(value)
            },
            placeholder = { Text(if (recovery) "xxxx-xxxx-xxxx-xxxx" else "000000") },
            singleLine = true,
            isError = error != null,
            supportingText = error?.let { message -> @Composable { Text(message) } },
            keyboardOptions = KeyboardOptions(keyboardType = if (recovery) KeyboardType.Ascii else KeyboardType.NumberPassword),
            textStyle = MaterialTheme.typography.titleLarge,
            modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("mfa.code"),
        )
        Button(onClick = { send(code) }, enabled = complete && !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.padding(end = 8.dp))
            Text(if (busy) "Verifying…" else submitLabel)
        }
        if (passkey != null) {
            TextButton(enabled = !busy, onClick = {
                busy = true
                scope.launch {
                    try { passkey() }
                    catch (e: CancellationException) { throw e }
                    // Dismissing the system sheet is not an error worth showing.
                    catch (_: GetCredentialCancellationException) {}
                    catch (e: Exception) { error = e.message }
                    finally { busy = false }
                }
            }) { Text("Use a passkey") }
        }
        TextButton(onClick = { recovery = !recovery; code = ""; error = null }) {
            Text(if (recovery) "Use your authenticator app" else "Use a recovery code")
        }
    }
    DisposableEffect(Unit) { runCatching { focus.requestFocus() }; onDispose {} }
}

/** A dialog that asks for a code before an action: settings, and every step-up. */
@Composable
fun MfaCodeDialog(
    title: String,
    text: String,
    submitLabel: String,
    onSubmit: suspend (String) -> Unit,
    onDismiss: () -> Unit,
    passkey: (suspend () -> Unit)? = null,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(text)
                MfaCodeForm(submitLabel, onSubmit, passkey = passkey)
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Answers step-up requests from any API call (data/StepUp.kt). Mounted once, over everything. */
@Composable
fun StepUpDialogHost() {
    DisposableEffect(Unit) {
        StepUp.hosted = true
        onDispose { StepUp.hosted = false; StepUp.cancel() }
    }
    val activity = androidx.activity.compose.LocalActivity.current
    if (StepUp.token != null) {
        MfaCodeDialog(
            title = "Confirm it’s you",
            text = "Enter a code from your authenticator app to continue.",
            submitLabel = "Continue",
            onSubmit = { StepUp.submit(it) },
            onDismiss = { StepUp.cancel() },
            passkey = if (activity != null) ({ StepUp.submitPasskey(activity) }) else null,
        )
    }
}
