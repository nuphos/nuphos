package ai.nuphos.android.ui.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.components.NuphosAvatar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(user: NuphosUser, workspaceName: String? = null, onWorkspace: (() -> Unit)? = null, onDismiss: () -> Unit) {
    val voiceContext = androidx.compose.ui.platform.LocalContext.current
    val injectedVoice = ai.nuphos.android.voice.LocalVoiceServices.current
    val voiceServices = remember(voiceContext, injectedVoice) { injectedVoice ?: ai.nuphos.android.voice.deviceVoiceServices(voiceContext) }
    val auth = LocalAuthSession.current
    var confirm by remember { mutableStateOf(false) }
    var edit by remember(user.id) { mutableStateOf(false) }
    var deletion by remember(user.id) { mutableStateOf(false) }
    var devices by remember(user.id) { mutableStateOf(false) }
    var withdraw by remember(user.id) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        if (onWorkspace != null) TextButton(onClick = onWorkspace, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
            Text((workspaceName ?: "Workspace") + " · Switch workspace")
        }
        ProfileContent(
            user = user,
            canWithdraw = auth.aiAllowed,
            consentBusy = auth.consentBusy,
            consentError = auth.consentError,
            onEdit = { edit = true },
            onDevices = { devices = true },
            onPrivacy = { uri.openUri("https://nuphos.ai/privacy") },
            onWithdraw = { withdraw = true },
            onDeletion = { deletion = true },
            onSignOut = { confirm = true },
            voiceSettings = { ai.nuphos.android.voice.VoiceSettingsSection(voiceServices) },
        )
    }
    if (edit) EditProfileSheet(user = auth.user ?: user, onDismiss = { edit = false })
    if (devices) SignedInDevicesSheet(onDismiss = { devices = false })
    if (deletion) AccountDeletionSheet(onDismiss = { deletion = false })
    if (withdraw) {
        AlertDialog(
            onDismissRequest = { withdraw = false },
            title = { Text("Withdraw AI sharing consent?") },
            text = { Text("This blocks new AI work from this app after the server confirms your choice. It does not undo data already sent or stop existing, scheduled or other-device runs. Unsent drafts will be cleared.") },
            confirmButton = { TextButton(enabled = !auth.consentBusy, onClick = { withdraw = false; auth.setAIConsent(false) }) { Text("Withdraw") } },
            dismissButton = { TextButton(onClick = { withdraw = false }) { Text("Cancel") } },
        )
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Sign out of Nuphos?") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    onDismiss()
                    auth.signOut()
                }) { Text("Sign out", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
        )
    }
}

@Composable
internal fun ProfileContent(
    user: NuphosUser,
    canWithdraw: Boolean,
    consentBusy: Boolean,
    consentError: String?,
    onEdit: () -> Unit,
    onDevices: () -> Unit,
    onPrivacy: () -> Unit,
    onWithdraw: () -> Unit,
    onDeletion: () -> Unit,
    onSignOut: () -> Unit,
    voiceSettings: @Composable () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(
            Modifier.widthIn(max = 600.dp).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                NuphosAvatar(user, size = 84.dp)
                Spacer(Modifier.height(8.dp))
                Text(user.displayName, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                if (user.username.isNotEmpty()) {
                    Text("@${user.username}", style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.primary, textAlign = TextAlign.Center)
                }
                Text(user.email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
            ProfileGroup("Account") {
                ProfileAction("Edit profile", onClick = onEdit)
                HorizontalDivider()
                ProfileAction("Signed-in devices", onClick = onDevices)
                HorizontalDivider()
                Column(Modifier.padding(horizontal = 16.dp)) {
                    ai.nuphos.android.ui.components.TechnicalDetails(user.id) {
                        Info("User ID", user.id, mono = true)
                    }
                }
            }
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                Column(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    voiceSettings()
                }
            }
            ProfileGroup("App icon") { AppIconPicker() }
            ProfileGroup("Privacy") {
                ProfileAction("Privacy policy", onClick = onPrivacy)
                if (canWithdraw) {
                    HorizontalDivider()
                    ProfileAction("Withdraw AI sharing consent", enabled = !consentBusy, onClick = onWithdraw)
                }
                HorizontalDivider()
                ProfileAction("Account deletion request", onClick = onDeletion)
                consentError?.let {
                    Text(it, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                }
            }
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                ProfileAction("Sign out", destructive = true, onClick = onSignOut)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun Info(label: String, value: String, mono: Boolean = false) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        Text(
            value.ifEmpty { "—" },
            style = MaterialTheme.typography.bodyLarge,
            fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
            color = if (value.isEmpty()) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface,
        )
    }
}


@Composable
private fun ProfileGroup(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            title,
            modifier = Modifier.padding(horizontal = 16.dp),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(Modifier.fillMaxWidth(), content = content)
        }
    }
}

@Composable
private fun ProfileAction(
    label: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    onClick: () -> Unit,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(12.dp),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(
            label,
            modifier = Modifier.fillMaxWidth(),
            style = MaterialTheme.typography.bodyLarge,
            color = if (destructive) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified,
        )
    }
}
