package ai.nuphos.android.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun StatusBadge(status: String, modifier: Modifier = Modifier) {
    val label = if (status == "cancelled") "Unplanned" else status.replaceFirstChar { it.uppercase() }
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
