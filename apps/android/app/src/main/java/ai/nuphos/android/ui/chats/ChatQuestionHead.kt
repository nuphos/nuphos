package ai.nuphos.android.ui.chats

import ai.nuphos.android.R
import ai.nuphos.android.model.HistoryTime
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.components.MarkdownText
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowOutward
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant

/**
 * The top of a question card in a Bot's chat or a Task (#2879), as Desktop #3473 and iOS #3489 draw it: who
 * asked, when it was another Bot or Task, and how long ago; the question as the heading; its body cut at
 * four lines behind a full-width Show more. The options under it are the card's usual row of pills.
 */
@Composable
internal fun ChatQuestionHead(question: BotQuestion, showsFrom: Boolean, onOpen: () -> Unit, onLink: ((String) -> Unit)?) {
    Column {
        if (showsFrom) Source(question, onOpen)
        Text(question.request.question, Modifier.semantics { heading() }.testTag("bot-question-heading"),
            style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp, lineHeight = 22.sp), fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface)
        question.ownBody?.let { Spacer(Modifier.height(4.dp)); Body(question.id, it, onLink) }
    }
}

/** The Bot or Task that asked: its face, its name (which opens it), ↗ and "· 15 days", fainter than the name. */
@Composable
private fun Source(question: BotQuestion, onOpen: () -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.padding(bottom = 6.dp).clickable(onClick = onOpen).testTag("bot-question-from"),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        AgentAvatar(question.sessionId, question.runtime, 14.dp, showBadge = false)
        Text(question.title, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = muted,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Icon(Icons.Outlined.ArrowOutward, null, Modifier.size(12.dp), tint = muted)
        question.request.askedAt?.let { runCatching { Instant.parse(it) }.getOrNull() }?.let {
            Text("· " + HistoryTime.format(it), Modifier.testTag("bot-question-age"), style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Normal, color = MaterialTheme.colorScheme.outline, maxLines = 1)
        }
    }
}

/** Up to four lines, the last fading out, then a full-width Show more; a tap on the cut body opens it too. */
@Composable
private fun Body(id: String, text: String, onLink: ((String) -> Unit)?) {
    val long = isLongBody(text)
    var expanded by rememberSaveable(id) { mutableStateOf(false) }
    val cut = long && !expanded
    val card = MaterialTheme.colorScheme.surfaceContainerHigh
    // In the secondary text color, as on iOS, so the question stands out above it.
    Box { MaterialTheme(colorScheme = MaterialTheme.colorScheme.copy(onSurface = MaterialTheme.colorScheme.onSurfaceVariant)) {
        MarkdownText(text, (if (cut) Modifier.heightIn(max = 84.dp).clipToBounds().clickable { expanded = true } else Modifier)
            .testTag("bot-question-body"), onLink = onLink, compact = true) }
        if (cut) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(30.dp)
            .background(Brush.verticalGradient(listOf(card.copy(alpha = 0f), card))))
    }
    if (long) Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable { expanded = !expanded }.testTag("bot-question-more"),
        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(if (expanded) R.string.chats_show_less else R.string.chats_show_more),
            style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp), fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.width(6.dp))
        Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurface)
    }
}
