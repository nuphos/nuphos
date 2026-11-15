package ai.nuphos.android.ui.chat

import ai.nuphos.android.model.ChatRow
import ai.nuphos.android.model.ChatTime
import ai.nuphos.android.ui.components.MarkdownText
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * "✓ Sam answered  Which region?  [ us-east ]  ⌄": a question someone answered, on one line.
 * Opened, it shows the question as it was asked under the line: its body, every option with the
 * picked ones filled, and when.
 */
@Composable
internal fun AnsweredLine(row: ChatRow.Answered, onLink: (String) -> Unit) {
    val question = row.question
    val colors = MaterialTheme.colorScheme
    var expanded by rememberSaveable(row.id) { mutableStateOf(false) }
    val who: @Composable () -> Unit = {
        Icon(Icons.Outlined.Check, contentDescription = null, tint = colors.onSurfaceVariant, modifier = Modifier.size(16.dp))
        Text("${question.name} answered", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = colors.onSurface, maxLines = 1, softWrap = false)
    }
    val asked: @Composable (Modifier) -> Unit = { modifier ->
        Text(question.question, style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = modifier)
    }
    val answer: @Composable () -> Unit = {
        Surface(shape = CircleShape, color = colors.surfaceContainerHigh) {
            Text(
                question.answer.lineSequence().first(),
                style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = colors.onSurface,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 180.dp).padding(horizontal = 10.dp, vertical = 3.dp),
            )
        }
    }
    val chevron: @Composable () -> Unit = {
        Icon(
            if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
            contentDescription = if (expanded) "Collapse question" else "Expand question",
            tint = colors.onSurfaceVariant, modifier = Modifier.size(18.dp),
        )
    }
    val spaced = Arrangement.spacedBy(8.dp)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Surface(
            onClick = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth().testTag("answered-line")
                .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" },
            color = colors.surface,
        ) {
            // One line when it all fits; a narrow screen gives the question and its answer a line of their own.
            SubcomposeLayout(Modifier.heightIn(min = 48.dp).padding(horizontal = 6.dp)) { constraints ->
                val one = subcompose("one") {
                    Row(horizontalArrangement = spaced, verticalAlignment = Alignment.CenterVertically) { who(); asked(Modifier); answer(); chevron() }
                }.single()
                val fits = one.maxIntrinsicWidth(constraints.maxHeight) <= constraints.maxWidth
                val placeable = (if (fits) one else subcompose("two") {
                    Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(horizontalArrangement = spaced, verticalAlignment = Alignment.CenterVertically) { who(); chevron() }
                        Row(horizontalArrangement = spaced, verticalAlignment = Alignment.CenterVertically) { asked(Modifier.weight(1f, fill = false)); answer() }
                    }
                }.single()).measure(constraints.copy(minWidth = 0))
                layout(constraints.maxWidth, placeable.height) { placeable.place(0, 0) }
            }
        }
        if (!expanded) return@Column
        Surface(shape = RoundedCornerShape(14.dp), color = colors.surfaceContainerHigh, modifier = Modifier.fillMaxWidth().testTag("answered-card")) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(question.question, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = colors.onSurface)
                // The body reads under the question, in the secondary color.
                question.body?.let { MaterialTheme(colorScheme = colors.copy(onSurface = colors.onSurfaceVariant)) { MarkdownText(it, onLink = onLink, compact = true) } }
                val picked = question.picked
                for (option in question.options) {
                    val chosen = option in picked
                    Surface(
                        shape = CircleShape,
                        color = if (chosen) colors.onSurface else colors.surfaceContainerHighest,
                        contentColor = if (chosen) colors.surface else colors.onSurface.copy(alpha = 0.45f),
                        modifier = Modifier.fillMaxWidth().semantics { selected = chosen },
                    ) {
                        Row(
                            Modifier.heightIn(min = 44.dp).padding(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (chosen) Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                            Text(option, style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
                if (picked.isEmpty()) Surface(shape = RoundedCornerShape(9.dp), color = colors.onSurface.copy(alpha = 0.05f), modifier = Modifier.fillMaxWidth()) {
                    Text(question.answer, style = MaterialTheme.typography.bodyMedium, color = colors.onSurface, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                }
                val answered = question.answered?.let(ChatTime::label).orEmpty()
                Text(
                    question.asked?.let { "Asked ${ChatTime.label(it)} · Answered $answered from the Inbox" } ?: "Answered $answered from the Inbox",
                    style = MaterialTheme.typography.bodySmall, color = colors.outline,
                )
            }
        }
    }
}
