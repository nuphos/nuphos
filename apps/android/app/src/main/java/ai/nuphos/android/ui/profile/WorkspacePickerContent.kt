package ai.nuphos.android.ui.profile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.Team
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

/** The Account sheet owns this page. Opening or dismissing it never selects a team. */
@Composable
internal fun WorkspacePickerContent(
    teams: List<Team>,
    selectedId: String?,
    onBack: () -> Unit,
    onSelect: (Team) -> Unit,
    onSetup: () -> Unit,
) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.profile_workspace_back)) }
            Text(stringResource(R.string.profile_workspace), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).testTag("workspace-picker-title"))
            TextButton(onClick = onBack) { Text(stringResource(R.string.cancel)) }
        }
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 520.dp), contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp)) {
            if (teams.isEmpty()) item {
                Text(stringResource(R.string.profile_workspace_none), Modifier.padding(vertical = 20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            items(teams.distinctBy { it.id }, key = { it.id }) { team ->
                val current = team.id == selectedId
                Row(Modifier.fillMaxWidth().semantics { selected = current }
                    .clickable(role = Role.RadioButton) { if (!current) onSelect(team) }
                    .padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(team.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                    if (current) Icon(Icons.Outlined.Check, stringResource(R.string.profile_workspace_current), tint = MaterialTheme.colorScheme.primary)
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
            item { TextButton(onClick = onSetup, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.profile_workspace_setup)) } }
        }
    }
}
