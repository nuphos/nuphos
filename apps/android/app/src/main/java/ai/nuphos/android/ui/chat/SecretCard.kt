package ai.nuphos.android.ui.chat

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
    var value by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // The value reached the runtime: sent from here, or the reply says so (Desktop and iOS send the same text).
    val saved = sent || reply?.startsWith(ChatPart.Tool.SecretRequest.savedReply(request.name)) == true
    if (saved) return SecretLine(Icons.Outlined.Lock, "${request.name} saved on the task's runtime.")
    if (reply != null) return SecretLine(Icons.Outlined.LockOpen, "${request.name} request closed. Ask the agent to request it again.")

    val blocked = when {
        !session.isOwner -> "Only the owner of this task can provide this secret."
        session.isStreaming -> "The agent is working. You can send this when its turn ends."
        else -> null
    }
    fun submit() {
        if (value.isEmpty() || saving || blocked != null) return
        val secret = value
        saving = true
        failure = null
        scope.launch {
            try {
                session.provideSecret(secret, part)
                value = ""
                sent = true
            } catch (e: Exception) {
                failure = "Could not save it on the agent's runtime: ${e.message ?: "unknown error"}"
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
                Text("Secret needed:", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(request.name, style = MaterialTheme.typography.bodyMedium, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium)
            }
            if (request.reason.isNotEmpty()) Text(request.reason, style = MaterialTheme.typography.bodySmall)
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                enabled = blocked == null && !saving,
                singleLine = true,
                placeholder = { Text("Paste the value") },
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    autoCorrectEnabled = false,
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Send,
                ),
                keyboardActions = KeyboardActions(onSend = { submit() }),
                modifier = Modifier.fillMaxWidth().testTag("secret-value:${part.toolCallId}"),
            )
            Button(onClick = ::submit, enabled = value.isNotEmpty() && !saving && blocked == null) {
                Text(if (saving) "Saving…" else "Send securely")
            }
            failure?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
            Text(blocked ?: "The value is written to a file on the task's runtime and never appears in this task.",
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
