package ai.nuphos.android.ui.profile

import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.testTag
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.foundation.layout.size
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
fun ProfileSheet(user: NuphosUser, workspaceName: String? = null, onWorkspace: (() -> Unit)? = null, workspacePicker: (@Composable (onBack: () -> Unit) -> Unit)? = null, onDismiss: () -> Unit) {
    val voiceContext = androidx.compose.ui.platform.LocalContext.current
    val injectedVoice = ai.nuphos.android.voice.LocalVoiceServices.current
    val voiceServices = remember(voiceContext, injectedVoice) { injectedVoice ?: ai.nuphos.android.voice.deviceVoiceServices(voiceContext) }
    val auth = LocalAuthSession.current
    val appearance = remember(voiceContext) { ai.nuphos.android.model.BotAvatarPreferences.get(voiceContext) }
    var choosingWorkspace by remember(auth.generation) { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    var edit by remember(user.id) { mutableStateOf(false) }
    var deletion by remember(user.id) { mutableStateOf(false) }
    var devices by remember(user.id) { mutableStateOf(false) }
    var withdraw by remember(user.id) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    val clipboard = LocalClipboardManager.current
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), dragHandle = null, containerColor = MaterialTheme.colorScheme.background) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Account", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).testTag("account-sheet-title"))
            TextButton(onClick = onDismiss) { Text("Done") }
        }
        ProfileContent(
            user = auth.user ?: user,
            canWithdraw = auth.aiAllowed,
            consentBusy = auth.consentBusy,
            consentError = auth.consentError,
            onEdit = { edit = true },
            onDevices = { devices = true },
            onPrivacy = { uri.openUri("https://nuphos.ai/privacy") },
            onWithdraw = { withdraw = true },
            onDeletion = { deletion = true },
            onSignOut = { confirm = true },
            onCopyUserId = { clipboard.setText(AnnotatedString((auth.user ?: user).id)) },
            botAvatarsEnabled = appearance.enabled,
            onBotAvatarsChange = appearance::update,
            voiceSettings = { ai.nuphos.android.voice.VoiceSettingsSection(voiceServices) },
            workspaceSettings = if (onWorkspace != null || workspacePicker != null) ({
                ProfileAction("Workspace", subtitle = workspaceName, disclosure = true,
                    onClick = { if (workspacePicker != null) choosingWorkspace = true else onWorkspace?.invoke() })
            }) else null,
        )
    }
    if (choosingWorkspace && workspacePicker != null) {
        ModalBottomSheet(onDismissRequest = { choosingWorkspace = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = MaterialTheme.colorScheme.background) {
            workspacePicker { choosingWorkspace = false }
        }
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
    onCopyUserId: () -> Unit = {},
    botAvatarsEnabled: Boolean = true,
    onBotAvatarsChange: (Boolean) -> Unit = {},
    voiceSettings: @Composable () -> Unit,
    workspaceSettings: (@Composable () -> Unit)? = null,
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
                Modifier.fillMaxWidth().padding(vertical = 8.dp)
                    .pointerInput(user.id, onCopyUserId) { detectTapGestures(onLongPress = { onCopyUserId() }) }
                    .semantics { customActions = listOf(CustomAccessibilityAction("Copy user ID") { onCopyUserId(); true }) },
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
                ProfileDivider(Modifier.testTag("profile-account-line-edit"))
                Info("Name", user.name)
                ProfileDivider(Modifier.testTag("profile-account-line-name"))
                Info("Username", user.username, mono = true)
                ProfileDivider(Modifier.testTag("profile-account-line-username"))
                Info("Email", user.email)
                ProfileDivider(Modifier.testTag("profile-account-line-email"))
                ProfileAction("Signed-in devices", disclosure = true, onClick = onDevices)
                if (workspaceSettings != null) {
                    ProfileDivider(Modifier.testTag("profile-account-line-workspace"))
                    workspaceSettings()
                }
            }
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
                Column(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    voiceSettings()
                }
            }
            ProfileGroup("Appearance") {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Bot avatars", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    androidx.compose.material3.Switch(checked = botAvatarsEnabled, onCheckedChange = onBotAvatarsChange,
                        modifier = Modifier.semantics { contentDescription = "Bot avatars" })
                }
                Text("Give Agents a character avatar. Turn off to show Runtime icons.", modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            ProfileGroup("App icon") { AppIconPicker() }
            ProfileGroup("Privacy") {
                ProfileAction("Privacy policy", onClick = onPrivacy)
                if (canWithdraw) {
                    ProfileDivider()
                    ProfileAction("Withdraw AI sharing consent", enabled = !consentBusy, onClick = onWithdraw)
                }
                ProfileDivider()
                ProfileAction("Account deletion request", onClick = onDeletion)
                if (!canWithdraw) Text("AI data sharing is off. Close Account to read the notice.", modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
                consentError?.let {
                    Text(it, modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.error)
                }
            }
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
                ProfileAction("Sign out", destructive = true, onClick = onSignOut)
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun Info(label: String, value: String, mono: Boolean = false) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline)
        SelectionContainer { Text(
            value.ifEmpty { "—" },
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 3,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
            fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
            color = if (value.isEmpty()) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onSurface,
        ) }
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
        Surface(modifier = Modifier.testTag("profile-group-$title"), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxWidth(), content = content)
        }
    }
}

@Composable
private fun ProfileAction(
    label: String,
    enabled: Boolean = true,
    destructive: Boolean = false,
    disclosure: Boolean = false,
    subtitle: String? = null,
    onClick: () -> Unit,
) {
    TextButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(12.dp),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label, style = MaterialTheme.typography.bodyLarge,
                    color = if (destructive) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified)
                subtitle?.takeIf { it.isNotEmpty() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                }
            }
            if (disclosure) Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null,
                modifier = Modifier.padding(start = 8.dp).size(18.dp).testTag("profile-disclosure-$label"), tint = MaterialTheme.colorScheme.outline)
        }
    }
}


/** Internal rows share their text inset; the group itself has no top/bottom rule. */
@Composable
private fun ProfileDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).then(modifier),
        thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
}
