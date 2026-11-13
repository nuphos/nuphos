package ai.nuphos.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.R
import ai.nuphos.android.model.SessionResource
import ai.nuphos.android.model.openFirst

/** Only PRs/issues already linked by the agent. No binding or editing controls. */
@Composable
fun SessionResourceStrip(
    resources: List<SessionResource>,
    loading: Boolean,
    failed: Boolean,
    onRefresh: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    var openFailed by remember(resources) { mutableStateOf(false) }
    // Merged and closed links no longer need attention, so they fold into one
    // chip after the open ones, as on Desktop.
    var showFinished by remember { mutableStateOf(false) }
    val (open, finished) = remember(resources) { resources.openFirst() }
    // Never dispatch arbitrary schemes or URLs containing credentials.
    val openLink: (String) -> Boolean = { url -> runCatching { uriHandler.openUri(url) }.isSuccess }
    if (resources.isEmpty() && !loading && !failed) return
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (resources.isNotEmpty()) LazyRow(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 6.dp),
            ) {
                items(open, key = { it.id }) { ResourceChip(it) { url -> openFailed = !openLink(url) } }
                if (finished.isNotEmpty()) item(key = "finished") {
                    FinishedChip(SessionResource.finishedLabel(finished), showFinished) { showFinished = !showFinished }
                }
                if (showFinished) items(finished, key = { it.id }) { ResourceChip(it) { url -> openFailed = !openLink(url) } }
            }
            if (loading) {
                CircularProgressIndicator(Modifier.padding(16.dp).size(18.dp).semantics { contentDescription = "Loading linked resources" }, strokeWidth = 2.dp)
            } else if (failed) {
                Text("Linked resources unavailable", Modifier.padding(start = 16.dp).weight(1f),
                    style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = onRefresh) { Text("Retry") }
            } else {
                IconButton(onClick = onRefresh) { Icon(Icons.Outlined.Refresh, "Refresh linked resources") }
            }
        }
        if (openFailed) Text("Could not open this link.", Modifier.padding(horizontal = 16.dp),
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun ResourceChip(resource: SessionResource, onOpen: (String) -> Unit) {
    val url = resource.safeUrl
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val tone = when {
        url == null -> MaterialTheme.colorScheme.onSurfaceVariant
        resource.provider != "github" -> MaterialTheme.colorScheme.onSurfaceVariant
        resource.state == "merged" -> MaterialTheme.colorScheme.primary
        resource.state == "closed" -> MaterialTheme.colorScheme.error
        resource.state == "open" -> if (dark) Color(0xFF80D69A) else Color(0xFF216E39)
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(
        onClick = { if (url != null) onOpen(url) },
        enabled = url != null,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "${resource.providerLabel}, ${resource.title}, ${resource.state}" +
                if (url == null) ", link unavailable" else ""
        },
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                painterResource(if (resource.provider == "github") R.drawable.ic_resource_github else R.drawable.ic_resource_linear),
                contentDescription = null, modifier = Modifier.size(14.dp),
                tint = if (resource.provider == "github") MaterialTheme.colorScheme.onSurface else Color(0xFF5E6AD2),
            )
            Text(resource.chip, style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.widthIn(max = 160.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(resource.state.replaceFirstChar { it.titlecase() }, color = tone,
                style = MaterialTheme.typography.labelMedium, modifier = Modifier.widthIn(max = 160.dp),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (url == null) Text("Link unavailable", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** The one chip standing for every finished link; tapping it shows or hides them. */
@Composable
private fun FinishedChip(label: String, expanded: Boolean, onToggle: () -> Unit) {
    Surface(
        onClick = onToggle,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainer,
        modifier = Modifier.semantics(mergeDescendants = true) {
            contentDescription = "$label, ${if (expanded) "hide" else "show"} finished links"
        },
    ) {
        Text(
            label,
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
