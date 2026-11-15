package ai.nuphos.android.ui.chat

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.model.ChatPart
import ai.nuphos.android.session.ChatSession
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * A secret the agent asked for, like the desktop's and iOS's `SecretCard`: a
 * masked field whose value goes straight to a file on the agent's runtime.
 * Only the file's path is sent as the reply. The value is held in plain
 * `remember` state, so it is never saved with the screen's state.
 */
@Composable
internal fun SecretCard(part: ChatPart.Tool, reply: String?, session: ChatSession) {
    val request = part.secretRequest ?: return
    // One value per field; a single secret is the only one.
    val count = request.fields?.size ?: 1
    var values by remember { mutableStateOf(List(count) { "" }) }
    var revealed by remember { mutableStateOf(false) }
    val complete = values.all { it.isNotEmpty() }
    // What the one-line states name: the site of a form's details, else the secret.
    val subject = request.site ?: request.name
    var saving by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val resources = androidx.compose.ui.platform.LocalResources.current

    // The value reached the runtime: sent from here, or the reply says so (Desktop and iOS send the same text).
    val saved = sent || reply?.startsWith(ChatPart.Tool.SecretRequest.savedReply(request.name)) == true
    if (saved) return SecretLine(Icons.Outlined.Lock, stringResource(R.string.composer_secret_saved, subject))
    if (reply != null) return SecretLine(Icons.Outlined.LockOpen, stringResource(R.string.composer_secret_closed, subject))

    val blocked = when {
        !session.isOwner -> stringResource(R.string.composer_secret_owner_only)
        session.isStreaming -> stringResource(R.string.composer_secret_busy)
        else -> null
    }
    fun submit() {
        if (!complete || saving || blocked != null) return
        val secrets = values
        saving = true
        failure = null
        scope.launch {
            try {
                session.provideSecrets(secrets, part)
                values = List(count) { "" }
                sent = true
            } catch (e: Exception) {
                failure = resources.getString(R.string.composer_secret_save_failed, e.message ?: resources.getString(R.string.composer_unknown_error))
            } finally {
                saving = false
            }
        }
    }

    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().testTag("secret-card:${part.toolCallId}"),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Outlined.Lock, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                if (request.site != null) {
                    Text(stringResource(R.string.composer_secret_details_needed, request.site), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                } else {
                    Text(stringResource(R.string.composer_secret_needed), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    Text(request.name, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
                }
            }
            if (request.reason.isNotEmpty()) Text(request.reason, style = MaterialTheme.typography.bodySmall)
            (request.fields ?: listOf(null)).forEachIndexed { index, field ->
                OutlinedTextField(
                    value = values[index],
                    onValueChange = { new -> values = values.toMutableList().also { it[index] = new } },
                    enabled = blocked == null && !saving,
                    singleLine = true,
                    label = field?.let { { Text(it.label) } },
                    placeholder = if (field == null) ({ Text(stringResource(R.string.composer_paste_value)) }) else null,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    visualTransformation = if (revealed) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None,
                        autoCorrectEnabled = false,
                        keyboardType = KeyboardType.Password,
                        imeAction = if (index == count - 1) ImeAction.Send else ImeAction.Next,
                    ),
                    keyboardActions = KeyboardActions(onSend = { submit() }),
                    modifier = Modifier.fillMaxWidth().testTag(
                        if (field == null) "secret-value:${part.toolCallId}" else "secret-value:${part.toolCallId}:${field.name}",
                    ),
                )
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Button(onClick = ::submit, enabled = complete && !saving && blocked == null) {
                    Text(if (saving) stringResource(R.string.composer_saving) else stringResource(R.string.composer_send_securely))
                }
                // A mistyped ID number or date is costly, so a form's details can be checked before sending.
                if (request.fields != null) {
                    TextButton(onClick = { revealed = !revealed }, modifier = Modifier.testTag("secret-reveal:${part.toolCallId}")) {
                        Text(stringResource(if (revealed) R.string.composer_secret_hide else R.string.composer_secret_reveal))
                    }
                }
            }
            failure?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
            Text(
                blocked ?: request.site?.let { stringResource(R.string.composer_secret_fields_footer, it) }
                    ?: stringResource(R.string.composer_secret_footer),
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The answered card: one line, no field. */
@Composable
private fun SecretLine(icon: ImageVector, text: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
