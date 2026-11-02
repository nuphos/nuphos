package ai.nuphos.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.size
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.MessageAttribution
import ai.nuphos.android.ui.components.MarkdownText

@Composable
internal fun MessageSenderLabel(sender: MessageAttribution) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(6.dp)) {
        androidx.compose.foundation.layout.Box(
            Modifier.size(20.dp).clip(androidx.compose.foundation.shape.CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center,
        ) {
            Text(sender.name.take(1).uppercase(), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            sender.avatarURL?.let { avatar ->
                coil3.compose.AsyncImage(model = avatar, contentDescription = null,
                    modifier = Modifier.size(20.dp), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
            }
        }
        Text(sender.label, style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2,
            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
    }
}

@Composable
internal fun AgentEventRow(row: ChatRow.Event, onLink: (String) -> Unit, attachments: @Composable () -> Unit = {}) {
    var expanded by rememberSaveable(row.id) { mutableStateOf(false) }
    val content = row.content
    Column(Modifier.fillMaxWidth()) {
        Surface(
            onClick = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth().semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
            color = MaterialTheme.colorScheme.surface,
        ) {
            Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(content.sender?.label.orEmpty(), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f))
                Text(content.text.trim().lineSequence().firstOrNull().orEmpty(),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(2f).padding(start = 8.dp))
                Icon(if (expanded) Icons.Outlined.ExpandMore else Icons.Outlined.ChevronRight,
                    contentDescription = if (expanded) "Collapse event" else "Expand event")
            }
        }
        if (expanded) {
            Surface(border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), shape = MaterialTheme.shapes.medium) {
                Column(Modifier.fillMaxWidth().padding(12.dp)) {
                    MarkdownText(content.text, streaming = false, onLink = onLink)
                    attachments()
                }
            }
        }
    }
}
