package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.RuntimeSelections

/**
 * The current Agent, shown next to Send. Tapping opens its picker or usage details.
 */
@Composable
fun AgentChip(selection: RuntimeSelections.Selection?, enabled: Boolean, onClick: () -> Unit, labelOverride: String? = null, modifier: Modifier = Modifier) {
    val selected = selection?.selected
    val label = labelOverride ?: when {
        selection?.reselectionRequired == true -> "Choose an available runtime"
        selected != null -> selected.label
        else -> "Choose runtime"
    }
    TextButton(
        modifier = modifier.semantics { contentDescription = if (labelOverride == null) "Runtime for new agents: $label" else "Runtime for this agent: $label" },
        enabled = enabled,
        onClick = onClick,
    ) {
        if (selected != null) ai.nuphos.android.ui.components.RuntimeMark(selected.provider, 16.dp)
        else Icon(Icons.Outlined.Memory, contentDescription = null, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false).widthIn(max = 160.dp))
        Spacer(Modifier.width(2.dp))
        Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, modifier = Modifier.size(16.dp))
    }
}
