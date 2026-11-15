package ai.nuphos.android.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

@Composable
fun StatusBadge(status: String, modifier: Modifier = Modifier) {
    val label = when (status) {
        "proposed" -> stringResource(R.string.shell_status_proposed)
        "approved" -> stringResource(R.string.shell_status_approved)
        "executing" -> stringResource(R.string.shell_status_executing)
        "completed" -> stringResource(R.string.shell_status_completed)
        "failed" -> stringResource(R.string.shell_status_failed)
        "rejected" -> stringResource(R.string.shell_status_rejected)
        "cancelled" -> stringResource(R.string.shell_status_unplanned)
        // A status this build does not know is shown as the server sent it.
        else -> status.replaceFirstChar { it.uppercase() }
    }
    val tint = when (status) {
        "proposed", "approved", "executing" -> MaterialTheme.colorScheme.primary
        "completed" -> Color(0xFF2E7D32)
        "failed" -> MaterialTheme.colorScheme.error
        "rejected", "cancelled" -> MaterialTheme.colorScheme.outline
        else -> MaterialTheme.colorScheme.tertiary
    }
    Surface(
        modifier = modifier,
        shape = MaterialTheme.shapes.extraLarge,
        color = tint.copy(alpha = 0.12f),
    ) {
        Text(
            label,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
            color = tint,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}
