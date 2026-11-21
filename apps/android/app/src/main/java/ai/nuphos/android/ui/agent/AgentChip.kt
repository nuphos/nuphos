package ai.nuphos.android.ui.agent

import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource
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
        selection?.reselectionRequired == true -> stringResource(R.string.agent_choose_available_runtime)
        selected != null -> ai.nuphos.android.model.RuntimeIdentity.detail(selected.provider, selected.label)
        else -> stringResource(R.string.agent_choose_runtime)
    }
    val description = if (labelOverride == null) stringResource(R.string.agent_runtime_for_new_tasks, label)
        else stringResource(R.string.agent_runtime_for_this_task, label)
    TextButton(
        modifier = modifier.semantics { contentDescription = description },
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
