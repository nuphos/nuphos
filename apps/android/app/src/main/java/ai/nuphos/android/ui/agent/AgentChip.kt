package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.RuntimeSelections

/**
 * The Agent that the next chat starts on, shown in the composer control row
 * next to the IAM and permission-mode chips — the same place Desktop keeps
 * its runtime selector. Tapping opens the Agent picker sheet.
 */
@Composable
fun AgentChip(selection: RuntimeSelections.Selection?, enabled: Boolean, onClick: () -> Unit) {
    val selected = selection?.selected
    val label = when {
        selection?.reselectionRequired == true -> "Choose an available Agent"
        selected != null -> selected.label
        else -> "Choose an Agent"
    }
    FilterChip(
        selected = selected != null,
        enabled = enabled,
        onClick = onClick,
        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(Icons.Outlined.AutoAwesome, contentDescription = "Agent for new chats", modifier = Modifier.size(16.dp)) },
    )
}
