package ai.nuphos.android.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

internal data class MemoryRecallAccess(
    val loaded: Boolean,
    val allowed: Boolean,
    val originTeamId: String,
    val selectedTeamId: String?,
) {
    val canExpand get() = loaded && allowed && originTeamId.isNotBlank() && originTeamId == selectedTeamId
}

internal fun ChatRow.MemoryRecall.visibleTeamLabels(access: MemoryRecallAccess): List<String> {
    if (!access.canExpand) return emptyList()
    val hiddenIds = entries.filter { it.scope != "team" }.map { it.id }.toSet()
    return entries.filter { it.scope == "team" && it.id !in hiddenIds }.distinctBy { it.id }
        .map { it.label.takeIf(String::isNotBlank) ?: "Memory label unavailable" }
}

@Composable
internal fun MemoryRecallRow(row: ChatRow.MemoryRecall, access: MemoryRecallAccess) {
    val labels = row.visibleTeamLabels(access)
    var expanded by remember(row.id, access, labels) { mutableStateOf(false) }
    val count = maxOf(row.entries.size, row.fetched)
    Column(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.chat_memory_recalled, count), style = MaterialTheme.typography.labelMedium)
        if (labels.isEmpty()) {
            Text(stringResource(R.string.chat_memory_details_unavailable), style = MaterialTheme.typography.bodySmall)
        } else {
            // Keep the control outside the bounded details scroll area.
            TextButton(onClick = { expanded = !expanded }) {
                Text(if (expanded) stringResource(R.string.chat_memory_hide_details) else stringResource(R.string.chat_memory_show_details))
            }
            if (expanded) {
                Column(Modifier.fillMaxWidth().heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
                    labels.forEach { label ->
                        Text(stringResource(R.string.chat_memory_team_label, label), Modifier.padding(vertical = 4.dp), style = MaterialTheme.typography.bodySmall)
                    }
                    if (count > labels.size) Text(stringResource(R.string.chat_memory_more_unavailable, count - labels.size), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
