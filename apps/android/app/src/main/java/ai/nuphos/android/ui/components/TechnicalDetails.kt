package ai.nuphos.android.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import ai.nuphos.android.R

/** Keep diagnostic fields available without dominating the normal reading path. */
@Composable
fun TechnicalDetails(identity: String, content: @Composable ColumnScope.() -> Unit) {
    var expanded by remember(identity) { mutableStateOf(false) }
    Column {
        TextButton(onClick = { expanded = !expanded }) {
            Text(stringResource(if (expanded) R.string.shell_hide_technical_details else R.string.shell_technical_details))
        }
        if (expanded) {
            androidx.compose.runtime.CompositionLocalProvider(
                androidx.compose.material3.LocalTextStyle provides MaterialTheme.typography.bodySmall,
                content = { Column(content = content) },
            )
        }
    }
}
