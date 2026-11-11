package ai.nuphos.android.ui.chats

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import ai.nuphos.android.model.InputRequest
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.ui.components.MarkdownText
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.clipToBounds

/**
 * An open question, in a Bot's chat or the Inbox, like Desktop's decision card: which agent asked,
 * the question and what the agent wrote to decide it from, each option as the reply, and "Other…" to
 * answer in words in the composer, quoting it. A connect or secure-input question is answered in the
 * conversation that asked, which the link opens. [showsFrom] is off for the Bot's own questions in its own chat.
 */
@Composable
internal fun BotQuestionCard(
    question: BotQuestion,
    onOpen: () -> Unit,
    onAnswer: (String) -> Unit,
    showsFrom: Boolean = true,
    onLink: ((String) -> Unit)? = null,
    /** Why the last answer could not be sent; the question is still open. */
    failure: String? = null,
    /** Starts an answer in words in the composer, quoting the question; absent where none answers it. */
    onReply: (() -> Unit)? = null,
    /** Chooses the asking conversation's credentials here, for an integration question; absent where it cannot. */
    onConnect: (() -> Unit)? = null,
) {
    val replies = cardReplies(question.request)
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag("bot-question"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (showsFrom) Row(Modifier.clickable(onClick = onOpen).testTag("bot-question-from"), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("From ${question.title}", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(heading(question.request.category), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                Text(question.request.question, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                question.request.body?.takeIf { it.isNotBlank() }?.let { QuestionBody(question.id, it, onLink) }
                if (replies == null && onConnect != null && question.connectable) {
                    val own = question.personalCredentials?.joinToString(" and ") { if (it == "github") "GitHub" else if (it == "linear") "Linear" else it }
                    OutlinedButton(onClick = onConnect, modifier = Modifier.testTag("bot-question-connect")) {
                        Text(own?.let { "Use your own $it" } ?: "Choose credentials")
                    }
                } else if (replies == null) {
                    OutlinedButton(onClick = onOpen) { Text("Answer in the conversation") }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        replies.forEach { (label, reply) ->
                            OutlinedButton(onClick = { onAnswer(reply) }, modifier = Modifier.testTag("bot-question-option")) { Text(label) }
                        }
                    }
                    if (onReply != null && question.typed) TextButton(onClick = onReply, Modifier.testTag("bot-question-other")) {
                        Text(if (question.request.options.orEmpty().any { it.isNotBlank() }) "Other…" else "Reply…")
                    }
                }
            }
        }
        if (failure != null) Text("Couldn't send the message · $failure", Modifier.testTag("bot-question-failure"),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}

/** The question's markdown body: a few lines at first, "Show more" for the rest, as on Desktop. */
@Composable
private fun QuestionBody(id: String, text: String, onLink: ((String) -> Unit)?) {
    val long = isLongBody(text)
    var expanded by rememberSaveable(id) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val clip = if (long && !expanded) Modifier.heightIn(max = 64.dp).clipToBounds() else Modifier
        MarkdownText(text, clip.testTag("bot-question-body"), onLink = onLink, compact = true)
        if (long) TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Show less" else "Show more") }
    }
}

/** More than about three lines of text: shown collapsed until asked for. */
internal fun isLongBody(text: String): Boolean = text.trim().lines().size > 3 || text.length > 240

/**
 * Desktop's `cardReplies`: one (label, reply) per option, or "Done." for a to-do; null when only
 * the conversation can answer it.
 */
internal fun cardReplies(request: InputRequest): List<Pair<String, String>>? {
    if (request.category == "credential" || request.category == "integration") return null
    val options = request.options.orEmpty().filter { it.isNotBlank() }
    return if (options.isEmpty()) listOf("Mark as done" to "Done.") else options.map { it to it }
}

private fun heading(category: String?): String = when (category) {
    "approval" -> "Approval needed"
    "preference" -> "Your choice"
    "credential" -> "Credential needed"
    "integration" -> "Integration needed"
    "risk_tradeoff" -> "Weigh the tradeoff"
    else -> "Decision needed"
}
