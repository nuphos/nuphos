package ai.nuphos.android.ui.profile

import ai.nuphos.android.data.BackendOrigin
import ai.nuphos.android.data.SavedAccount
import ai.nuphos.android.session.AuthSession
import ai.nuphos.android.ui.components.NuphosAvatar
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Saved accounts with switching and per-account sign-out; shared by Account and sign-in. */
@Composable
fun SavedAccountsList(auth: AuthSession, allowAdding: Boolean, onSwitch: () -> Unit = {}) {
    var removing by remember { mutableStateOf<SavedAccount?>(null) }
    val busy = auth.state is AuthSession.State.SigningIn
    val accounts = auth.savedAccounts
    Column(Modifier.fillMaxWidth().testTag("saved-accounts")) {
        accounts.forEachIndexed { index, account ->
            val active = auth.state is AuthSession.State.SignedIn && account.token != null && account.token == auth.token
            AccountRow(account, if (active) auth.user else null, busy,
                onSelect = { if (!active) { onSwitch(); auth.selectAccount(account.id) } },
                onSignOut = { removing = account })
            if (index < accounts.lastIndex || allowAdding) Divider()
        }
        if (allowAdding) Row(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = !busy) { onSwitch(); auth.addAccount() }
                .padding(horizontal = 16.dp, vertical = 8.dp).testTag("saved-accounts-add"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(Modifier.size(36.dp), shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Add, contentDescription = null, Modifier.size(20.dp)) }
            }
            Spacer(Modifier.width(12.dp))
            Text("Add account", style = MaterialTheme.typography.bodyLarge)
        }
    }
    removing?.let { account ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Sign out of this account?") },
            text = { Text(account.user.email.ifEmpty { account.user.displayName }) },
            confirmButton = {
                TextButton(onClick = { removing = null; auth.removeAccount(account.id) }) {
                    Text("Sign out", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun AccountRow(account: SavedAccount, activeUser: ai.nuphos.android.model.NuphosUser?, busy: Boolean, onSelect: () -> Unit, onSignOut: () -> Unit) {
    val user = activeUser ?: account.user
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = !busy, onClick = onSelect)
            .semantics { selected = activeUser != null }
            .padding(start = 16.dp, top = 8.dp, bottom = 8.dp).testTag("saved-account-${user.id}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        NuphosAvatar(user, size = 36.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(user.displayName, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(user.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (!BackendOrigin.isCloud(account.origin)) Text(account.origin.removePrefix("https://"),
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.outline, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (account.token == null) Text("Sign in again", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
        }
        if (activeUser != null) Icon(Icons.Filled.CheckCircle, contentDescription = "Active account",
            Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
        Box {
            IconButton(onClick = { menu = true }, enabled = !busy) {
                Icon(Icons.Outlined.MoreVert, contentDescription = "Account options for ${user.email}",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Sign out", color = MaterialTheme.colorScheme.error) },
                    onClick = { menu = false; onSignOut() })
            }
        }
    }
}

@Composable
private fun Divider() {
    HorizontalDivider(Modifier.fillMaxWidth().padding(start = 64.dp, end = 16.dp),
        thickness = 0.5.dp, color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f))
}
