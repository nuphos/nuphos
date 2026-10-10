package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import ai.nuphos.android.session.RuntimeSelections

/** Displays the same account/team selection used to create the next chat. */
@Composable
fun AgentSelectionButton(selection: RuntimeSelections.Selection?, enabled: Boolean, onClick: () -> Unit) {
    val selected = selection?.selected
    OutlinedButton(onClick = onClick, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth()) {
            Text("Agent for new chats", style = MaterialTheme.typography.labelMedium)
            Text(if (selection?.reselectionRequired == true) "Choose an available Agent" else selected?.label ?: "Choose an Agent",
                style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (selected != null) Text(
                if (selected.provider == "codex") "Codex · Change Agent" else "Claude Code · Change Agent",
                style = MaterialTheme.typography.labelMedium)
        }
    }
}
