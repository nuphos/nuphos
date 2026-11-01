package ai.nuphos.android.ui.plans

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.Plan

/** Read-only disclosure; commands shown here are never executed by the UI. */
@Composable
internal fun PlanSteps(steps: List<Plan.Step>) {
    val statuses = steps.map { it.rollupStatus }
    val lastRunning = statuses.indexOfLast { it == "running" }
    steps.forEachIndexed { index, step ->
        val status = if (statuses[index] == "running" && index != lastRunning) "partial" else statuses[index]
        key(index, step.title) {
            var manualOpen by remember { mutableStateOf<Boolean?>(null) }
            val open = step.jobs.isEmpty() || (manualOpen ?: (status == "running" || status == "failed"))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = step.jobs.isNotEmpty()) { manualOpen = !open }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(when (status) { "done" -> "✓"; "failed" -> "×"; "running" -> "◉"; "partial" -> "◐"; else -> "${index + 1}" },
                        color = when (status) { "failed" -> MaterialTheme.colorScheme.error; else -> MaterialTheme.colorScheme.primary },
                        modifier = Modifier.width(20.dp))
                    Text(step.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    if (step.jobs.isNotEmpty()) Text(if (open) "⌄" else "›", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (open) SelectionContainer {
                    Column(Modifier.padding(start = 28.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        step.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        step.jobs.forEach { job ->
                            Text(job.title, style = MaterialTheme.typography.titleSmall)
                            job.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            job.commands.forEach { command ->
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text(when (command.status) { "done" -> "✓"; "failed" -> "×"; "running" -> "◉"; else -> "○" }, color = if (command.status == "failed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(command.command, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                                }
                                if (command.status == "failed") command.stderr?.takeIf { it.isNotBlank() }?.let {
                                    Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 6)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
