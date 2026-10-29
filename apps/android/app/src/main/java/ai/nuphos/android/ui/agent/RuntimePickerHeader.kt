package ai.nuphos.android.ui.agent

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
internal fun RuntimePickerHeader(title: String = "Choose runtime", enabled: Boolean = true, onClose: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
        Text(title, Modifier.align(Alignment.Center).padding(horizontal = 56.dp), style = MaterialTheme.typography.titleMedium)
        IconButton(onClick = onClose, enabled = enabled, modifier = Modifier.align(Alignment.CenterStart)) {
            Icon(Icons.Outlined.Close, "Close runtime picker")
        }
    }
}
