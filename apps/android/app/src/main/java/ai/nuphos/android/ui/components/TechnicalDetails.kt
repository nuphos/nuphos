package ai.nuphos.android.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*

/** Keep diagnostic fields available without dominating the normal reading path. */
@Composable
fun TechnicalDetails(identity: String, content: @Composable ColumnScope.() -> Unit) {
    var expanded by remember(identity) { mutableStateOf(false) }
    Column {
        TextButton(onClick = { expanded = !expanded }) {
            Text(if (expanded) "Hide technical details" else "Technical details")
        }
        if (expanded) {
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalTextStyle provides MaterialTheme.typography.bodySmall,
                content = { Column(content = content) },
            )
        }
    }
}
