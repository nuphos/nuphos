package ai.nuphos.android.ui.login

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.NuphosApi
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Email-first sign-in, matching iOS: the welcome form sends a code (or signs in with a
 * password on the same screen), then a dedicated screen takes the six-digit code.
 */
@Composable
internal fun EmailLoginContent(
    busy: Boolean,
    error: String?,
    onSubmit: (email: String, code: String) -> Unit,
    onPasswordSubmit: (email: String, password: String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    onDismissError: () -> Unit = {},
    header: @Composable ColumnScope.() -> Unit = {},
    alternatives: @Composable ColumnScope.() -> Unit = {},
    nowMillis: () -> Long = System::currentTimeMillis,
    requestCode: suspend (String) -> Unit = { AccountApi("").requestSignInCode(it) },
) {
    var email by rememberSaveable { mutableStateOf("") }
    var usePassword by rememberSaveable { mutableStateOf(false) }
    var codeScreen by rememberSaveable { mutableStateOf(false) }
    var sentEmail by rememberSaveable { mutableStateOf("") }
    var sentAt by rememberSaveable { mutableLongStateOf(0L) }
    var resendAt by rememberSaveable { mutableLongStateOf(0L) }
    // Only non-secret progress is saveable. Recreation always asks for credentials again.
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var localError by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    var now by remember { mutableLongStateOf(nowMillis()) }
    val scope = rememberCoroutineScope()
    val waiting = sending || busy
    val cleanEmail = email.trim()
    val validEmail = EmailCodeTiming.isEmail(cleanEmail)
    val expired = sentAt > 0 && now >= sentAt + EmailCodeTiming.EXPIRY_MS
    val seconds = EmailCodeTiming.remainingSeconds(resendAt, now)
    val shownError = localError ?: error
    LaunchedEffect(Unit) {
        while (true) { now = nowMillis(); delay(1_000) }
    }
    fun clearFeedback() { localError = null; onDismissError() }
    fun send() {
        if (waiting || !validEmail || nowMillis() < resendAt) return
        sending = true; clearFeedback(); code = ""; password = ""
        val target = cleanEmail
        // Reserve cooldown before dispatch; recreation/uncertain delivery must not send twice.
        resendAt = nowMillis() + EmailCodeTiming.COOLDOWN_MS
        job = scope.launch {
            try {
                requestCode(target)
                sentEmail = target
                sentAt = nowMillis()
                resendAt = sentAt + EmailCodeTiming.COOLDOWN_MS
                codeScreen = true
            } catch (e: CancellationException) { throw e }
            catch (e: NuphosApi.Failure.Http) {
                localError = when (e.code) {
                    400 -> "Enter a valid email address."
                    429 -> "Too many codes requested. Wait and try again later."
                    else -> "Could not send the code. Check your connection and try again."
                }
            } catch (_: Exception) {
                localError = "Could not confirm delivery. Wait before trying again."
            } finally { sending = false }
        }
    }
    fun continueWithEmail() {
        // A code already sent to this address is still valid: reopen it instead of sending again.
        if (sentAt > 0 && sentEmail == cleanEmail && !expired) { clearFeedback(); codeScreen = true } else send()
    }
    fun leaveCodeScreen() {
        if (busy) onCancel()
        job?.cancel(); code = ""; clearFeedback(); codeScreen = false
    }

    if (codeScreen) {
        BackHandler { leaveCodeScreen() }
        Column(modifier.fillMaxSize().systemBarsPadding().imePadding()
            .verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Check your email", style = MaterialTheme.typography.headlineLarge)
            Text("Enter the 6-digit code sent to", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(sentEmail, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f, fill = false))
                TextButton(onClick = { leaveCodeScreen() }, enabled = !sending,
                    modifier = Modifier.semantics { contentDescription = "Use a different email" }) { Text("Change") }
            }
            VerificationCodeField(code, isError = shownError != null, enabled = !waiting && !expired) {
                code = it; if (shownError != null) clearFeedback()
            }
            shownError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Didn't get a code?", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (seconds > 0) Text("Resend code in ${seconds}s", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 12.dp))
                else TextButton(onClick = { send() }, enabled = !waiting) { Text("Resend code") }
                Text(if (expired) "Code expired. Request a new code." else "The code expires in 10 minutes.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            Button(onClick = {
                if (!waiting && !expired && code.length == 6) {
                    val submitted = code
                    clearFeedback()
                    onSubmit(sentEmail, submitted)
                }
            }, enabled = !waiting && !expired && code.length == 6, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                Text(if (waiting) "Please wait…" else "Sign in")
            }
        }
        return
    }

    BackHandler(enabled = waiting) { job?.cancel(); onCancel() }
    val uri = LocalUriHandler.current
    val passwordFocus = remember { FocusRequester() }
    val passwordReady = validEmail && password.length in 12..128
    fun submitPassword() {
        if (!passwordReady || waiting) return
        val credential = password; password = ""; clearFeedback()
        onPasswordSubmit(cleanEmail, credential)
    }
    Column(modifier.fillMaxSize().systemBarsPadding().imePadding()
        .verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        header()
        OutlinedTextField(email, { email = it.take(254); if (shownError != null) clearFeedback() },
            label = { Text("Email address") }, singleLine = true, enabled = !waiting,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email,
                imeAction = if (usePassword) ImeAction.Next else ImeAction.Go),
            keyboardActions = KeyboardActions(onNext = { passwordFocus.requestFocus() }, onGo = { if (validEmail) continueWithEmail() }),
            modifier = Modifier.fillMaxWidth())
        if (usePassword) OutlinedTextField(password, { password = it.take(128); if (shownError != null) clearFeedback() },
            label = { Text("Password") }, singleLine = true, enabled = !waiting,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { submitPassword() }),
            modifier = Modifier.fillMaxWidth().focusRequester(passwordFocus))
        Button(onClick = { if (usePassword) submitPassword() else continueWithEmail() },
            enabled = !waiting && if (usePassword) passwordReady else validEmail && (seconds == 0 || sentEmail == cleanEmail),
            modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text(if (waiting) "Please wait…" else if (usePassword) "Sign in" else "Continue")
        }
        shownError?.let { Text(it, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
        if (!usePassword && seconds > 0 && sentEmail != cleanEmail)
            Text("You can request another code in ${seconds}s.", style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        TextButton(onClick = { usePassword = !usePassword; password = ""; clearFeedback() }, enabled = !waiting,
            modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text(if (usePassword) "Use an email code instead" else "Use a password")
        }
        alternatives()
        Text(buildAnnotatedString {
            append("By continuing, you agree to our ")
            withLink(LinkAnnotation.Clickable("terms") { uri.openUri("https://nuphos.ai/terms") }) {
                withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { append("Terms of Service") }
            }
            append(" and ")
            withLink(LinkAnnotation.Clickable("privacy") { uri.openUri("https://nuphos.ai/privacy") }) {
                withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { append("Privacy Policy") }
            }
            append(".")
        }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
    }
}

/** Six cells over one field, so pasting or autofill fills every digit at once. */
@Composable
private fun VerificationCodeField(code: String, isError: Boolean, enabled: Boolean, onChange: (String) -> Unit) {
    val focus = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    BasicTextField(
        value = code,
        onValueChange = { onChange(it.filter { c -> c in '0'..'9' }.take(6)) },
        enabled = enabled, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        cursorBrush = SolidColor(Color.Transparent),
        textStyle = MaterialTheme.typography.bodyLarge.copy(color = Color.Transparent),
        modifier = Modifier.fillMaxWidth().focusRequester(focus).onFocusChanged { focused = it.isFocused }
            .testTag("email-code-input").semantics { contentDescription = "6-digit email code" },
        decorationBox = { inner ->
            Box {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(6) { index ->
                        val active = focused && index == code.length.coerceAtMost(5)
                        val color = when {
                            isError -> MaterialTheme.colorScheme.error
                            active -> MaterialTheme.colorScheme.onSurface
                            else -> MaterialTheme.colorScheme.outlineVariant
                        }
                        Box(Modifier.weight(1f).aspectRatio(0.85f)
                            .border(if (active || isError) 2.dp else 1.dp, color, RoundedCornerShape(12.dp)),
                            contentAlignment = Alignment.Center) {
                            Text(code.getOrNull(index)?.toString().orEmpty(), style = MaterialTheme.typography.headlineSmall)
                        }
                    }
                }
                Box(Modifier.matchParentSize()) { inner() }
            }
        },
    )
}

internal object EmailCodeTiming {
    const val COOLDOWN_MS = 60_000L
    const val EXPIRY_MS = 600_000L
    fun remainingSeconds(deadline: Long, now: Long): Int =
        ((deadline - now).coerceAtLeast(0L).coerceAtMost(COOLDOWN_MS) + 999L).div(1_000).toInt()
    fun isEmail(value: String): Boolean =
        value.length in 3..254 && Regex("[^@\\s]+@[^@\\s]+\\.[^@\\s]+").matches(value)
}
