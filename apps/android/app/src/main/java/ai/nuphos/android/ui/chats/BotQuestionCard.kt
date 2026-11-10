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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.ImeAction
import ai.nuphos.android.model.InputRequest
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.session.BotQuestion

/**
 * An open question, in a Bot's chat or the Inbox, like Desktop's decision card: which agent asked,
 * the question, each option as the reply, and a short typed answer. A connect or secure-input
 * question is answered in the conversation that asked, which the link opens.
 */
@Composable
internal fun BotQuestionCard(question: BotQuestion, onOpen: () -> Unit, onAnswer: (String) -> Unit) {
    val replies = cardReplies(question.request)
    var draft by rememberSaveable(question.id) { mutableStateOf("") }
    val send = { draft.trim().takeIf { it.isNotEmpty() }?.let { draft = ""; onAnswer(it) }; Unit }
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag("bot-question"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.clickable(onClick = onOpen).testTag("bot-question-from"), verticalAlignment = Alignment.CenterVertically,
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
                if (replies == null) {
                    OutlinedButton(onClick = onOpen) { Text("Answer in the conversation") }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        replies.forEach { (label, reply) ->
                            OutlinedButton(onClick = { onAnswer(reply) }, modifier = Modifier.testTag("bot-question-option")) { Text(label) }
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(draft, { draft = it }, Modifier.weight(1f).testTag("bot-question-reply"),
                            placeholder = { Text("Or type a different answer") }, singleLine = true,
                            textStyle = MaterialTheme.typography.bodyMedium,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                            keyboardActions = KeyboardActions(onSend = { send() }))
                        TextButton(onClick = send, enabled = draft.isNotBlank()) { Text("Send") }
                    }
                }
            }
        }
    }
}

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
