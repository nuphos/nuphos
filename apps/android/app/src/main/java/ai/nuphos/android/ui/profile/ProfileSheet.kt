package ai.nuphos.android.ui.profile

import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.NuphosUser
import ai.nuphos.android.ui.LocalAuthSession
import ai.nuphos.android.ui.components.NuphosAvatar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(user: NuphosUser, onDismiss: () -> Unit) {
    val auth = LocalAuthSession.current
    var confirm by remember { mutableStateOf(false) }
    var edit by remember(user.id) { mutableStateOf(false) }
    var deletion by remember(user.id) { mutableStateOf(false) }
    var withdraw by remember(user.id) { mutableStateOf(false) }
    val uri = LocalUriHandler.current
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            NuphosAvatar(user, size = 84.dp)
            Spacer(Modifier.height(14.dp))
            Text(user.displayName, style = MaterialTheme.typography.headlineSmall)
            if (user.username.isNotEmpty()) {
                Text("@${user.username}", style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.primary)
            }
            Text(user.email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(24.dp))
            ai.nuphos.android.ui.components.TechnicalDetails(user.id) {
                Info("User ID", user.id, mono = true)
            }
            HorizontalDivider(Modifier.padding(vertical = 16.dp))
            TextButton(onClick = { edit = true }, modifier = Modifier.fillMaxWidth()) { Text("Edit profile") }
            TextButton(onClick = { uri.openUri("https://nuphos.ai/privacy") }, modifier = Modifier.fillMaxWidth()) { Text("Privacy policy") }
            HorizontalDivider(Modifier.padding(vertical = 12.dp))
            Text("Account actions", style = MaterialTheme.typography.titleSmall)
            TextButton(onClick = { deletion = true }, modifier = Modifier.fillMaxWidth()) { Text("Account deletion request") }
            if (auth.aiAllowed) {
                TextButton(onClick = { withdraw = true }, enabled = !auth.consentBusy, modifier = Modifier.fillMaxWidth()) { Text("Withdraw AI sharing consent") }
            }
            auth.consentError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            TextButton(onClick = { confirm = true }, modifier = Modifier.fillMaxWidth()) {
                Text("Sign out", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
    if (edit) EditProfileSheet(user = auth.user ?: user, onDismiss = { edit = false })
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
