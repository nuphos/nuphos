package ai.nuphos.android.ui.profile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.AccountApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.SignInSession
import ai.nuphos.android.model.SignInSessions
import ai.nuphos.android.ui.LocalAuthSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.Instant

sealed interface DevicesLoad {
    data object Loading : DevicesLoad
    data class Ready(val sessions: List<SignInSession>) : DevicesLoad
    /** A sign-in from before sessions: it works, but has no session to manage from. */
    data object SignInAgain : DevicesLoad
    data object Failed : DevicesLoad
}

/** The API's answer to a sign-in from before sessions. Not an error, and never a reason to sign out. */
internal fun Throwable.isSessionRequired() =
    this is NuphosApi.Failure.Http && code == 403 && errorCode == "session_required"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignedInDevicesSheet(onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    val token = auth.token ?: return
    val generation = auth.generation
    val scope = rememberCoroutineScope()
    var load by remember(token, generation) { mutableStateOf<DevicesLoad>(DevicesLoad.Loading) }
    var busy by remember(token, generation) { mutableStateOf(false) }
    var notice by remember(token, generation) { mutableStateOf<String?>(null) }
    fun current() = auth.token == token && auth.generation == generation
    fun failed(e: Exception): Boolean {
        if (!current()) return true
        if (e is NuphosApi.Failure.Unauthorized) { onDismiss(); auth.signOut(e.message); return true }
        return false
    }
    suspend fun refresh() {
        try {
            val sessions = AccountApi(token).signInSessions()
            if (current()) load = DevicesLoad.Ready(SignInSessions.sorted(sessions))
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            if (!failed(e)) load = if (e.isSessionRequired()) DevicesLoad.SignInAgain else DevicesLoad.Failed
        }
    }
    LaunchedEffect(token, generation) { refresh() }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        SignedInDevicesContent(
            load = load,
            busy = busy,
            notice = notice,
            onSignOut = { target ->
                busy = true; notice = null
                scope.launch {
                    try {
                        notice = if (target == null) {
                            val revoked = AccountApi(token).signOutOtherSessions()
                            "Signed out $revoked other device${if (revoked == 1) "" else "s"}."
                        } else {
                            AccountApi(token).signOutSession(target.id)
                            "Signed out ${SignInSessions.device(target)}."
                        }
                    } catch (e: CancellationException) { throw e
                    } catch (e: Exception) {
                        if (!failed(e)) notice = "Could not sign out. Please try again."
                    } finally {
                        if (current()) { refresh(); busy = false }
                    }
                }
            },
            onSignInAgain = { onDismiss(); auth.signOut() },
            onRetry = { load = DevicesLoad.Loading; scope.launch { refresh() } },
        )
    }
}

/** `onSignOut(null)` signs out every other device. Both actions ask first. */
@Composable
internal fun SignedInDevicesContent(
    load: DevicesLoad,
    busy: Boolean,
    notice: String?,
    onSignOut: (SignInSession?) -> Unit,
    onSignInAgain: () -> Unit,
    onRetry: () -> Unit,
    now: Instant = Instant.now(),
) {
    var confirming by remember { mutableStateOf<Confirming?>(null) }
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Signed-in devices", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Where your account is signed in. Sign out anything you don’t recognize, then change your password.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        when (load) {
            DevicesLoad.Loading -> CircularProgressIndicator(Modifier.align(Alignment.CenterHorizontally).padding(16.dp))
            DevicesLoad.SignInAgain -> Card {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Sign in again to manage your devices.", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "This device signed in before device management existed.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(onClick = onSignInAgain, modifier = Modifier.padding(top = 6.dp)) { Text("Sign out and sign in again") }
                }
            }
            DevicesLoad.Failed -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Couldn’t load your signed-in devices.", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onRetry) { Text("Retry") }
            }
            is DevicesLoad.Ready -> {
                Card {
                    load.sessions.forEachIndexed { index, session ->
                        if (index > 0) HorizontalDivider()
                        DeviceRow(session, now, enabled = !busy, onSignOut = { confirming = Confirming(session) })
                    }
                }
                if (load.sessions.any { it.current != true }) {
                    OutlinedButton(onClick = { confirming = Confirming(null) }, enabled = !busy) { Text("Sign out all other devices") }
                }
            }
        }
        notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(8.dp))
    }
    confirming?.let { (session) ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            title = { Text(if (session == null) "Sign out all other devices?" else "Sign out ${SignInSessions.device(session)}?") },
            text = {
                Text(if (session == null) "Every device except this one will need to sign in again." else "That device will need to sign in again.")
            },
            confirmButton = {
                TextButton(onClick = { confirming = null; onSignOut(session) }) {
                    Text("Sign out", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text("Cancel") } },
        )
    }
}

/** Asking before signing out [session], or every other device when it is null. */
private data class Confirming(val session: SignInSession?)

@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth(), content = content)
    }
}

@Composable
private fun DeviceRow(session: SignInSession, now: Instant, enabled: Boolean, onSignOut: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    SignInSessions.device(session),
                    Modifier.weight(1f, fill = false),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (session.current == true) {
                    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)) {
                        Text(
                            "This device",
                            Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                }
            }
            Text(
                listOfNotNull(SignInSessions.place(session), SignInSessions.activity(session, now)).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (session.current != true) {
            TextButton(onClick = onSignOut, enabled = enabled) { Text("Sign out") }
        }
    }
}
