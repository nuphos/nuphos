package ai.nuphos.android.ui.chats

import ai.nuphos.android.ui.chat.AskedSecretCard
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.FilledTonalButton
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.DecisionQuestion
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.ui.components.MarkdownText
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.clipToBounds
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

/**
 * An open question, in a Bot's chat or the Inbox, like Desktop's decision card: which agent asked,
 * the question and what the agent wrote to decide it from, each option an answer, and "Other…" to
 * type the answer in the card (in the Inbox, [answersInPlace], the text box is always there). A card
 * with several questions or any number of picks picks the same options and sends them once as [onForm]. An answer
 * wakes the agent that asked; no message is sent. A connect question opens the asking conversation's
 * credential picker ([onConnect]); a secret one, its secure input. [showsFrom] is off for the Bot's own
 * questions in its own chat.
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
    /** Chooses the asking conversation's credentials here, for an integration question; absent where it cannot. */
    onConnect: () -> Unit,
    /** The text box is always on the card, rather than behind "Other…", as the Inbox shows it. */
    answersInPlace: Boolean = false,
    /** A several-question or multi-select card's answer, as its form builds it. */
    onForm: (JsonValue) -> Unit = {},
) {
    val replies = cardReplies(question)
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag("bot-question"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (showsFrom) Row(Modifier.clickable(onClick = onOpen).testTag("bot-question-from"), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.chats_question_from, question.title), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(heading(question.request.category), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Medium)
                // One line, cut with an ellipsis, as on Desktop and iOS; a tap shows it in full.
                var open by rememberSaveable(question.id) { mutableStateOf(false) }
                Text(question.request.question, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = if (open) Int.MAX_VALUE else 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { open = !open }.testTag("bot-question-title"))
                question.ownBody?.let { QuestionBody(question.id, it, onLink) }
                val form = question.form
                val secret = question.secretPart
                if (form != null) QuestionOptions(question.id, form, pick = true, question.typed, answersInPlace, onAnswer, onForm)
                else if (secret != null) AskedSecretCard(question, secret)
                else if (replies == null) {
                    val own = question.personalCredentials?.map { if (it == "github") "GitHub" else if (it == "linear") "Linear" else it }
                        ?.foldIndexed("") { index, all, name -> if (index == 0) name else stringResource(R.string.chats_question_credentials_and, all, name) }
                    OutlinedButton(onClick = onConnect, modifier = Modifier.testTag("bot-question-connect")) {
                        Text(own?.let { stringResource(R.string.chats_question_use_own, it) } ?: stringResource(R.string.chats_question_choose_credentials))
                    }
                } else QuestionOptions(question.id, listOf(DecisionQuestion(question.request.question, replies.map { it.second })),
                    pick = false, question.typed, answersInPlace, onAnswer, onForm)
            }
        }
        if (failure != null) Text(stringResource(R.string.chats_question_send_failed, failure), Modifier.testTag("bot-question-failure"),
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
        if (long) TextButton(onClick = { expanded = !expanded }) { Text(stringResource(if (expanded) R.string.chats_show_less else R.string.chats_show_more)) }
    }
}

/** More than about three lines of text: shown collapsed until asked for. */
internal fun isLongBody(text: String): Boolean = text.trim().lines().size > 3 || text.length > 240

/** One (label, reply) per option, possibly none; null for a secret or a connection, answered in their own way. */
internal fun cardReplies(question: BotQuestion): List<Pair<String, String>>? {
    val request = question.request
    if (request.secretName != null || question.connectable) return null
    return request.options.orEmpty().filter { it.isNotBlank() }.map { it to it }
}

/**
 * A card's options, one design whether one or any number may be picked, as Desktop's
 * `DecisionOptions`: each option a button, "Other…" for the answer in words (in the Inbox,
 * [answersInPlace], the text box is already there), and "Send answer". One single-choice question
 * ([pick] off) is answered by its option, and Send sends only its words; a multi-select or several
 * questions pick their options, filled with a check once picked, and Send sends them together.
 */
@Composable
private fun QuestionOptions(
    id: String,
    questions: List<DecisionQuestion>,
    pick: Boolean,
    typed: Boolean,
    answersInPlace: Boolean,
    onAnswer: (String) -> Unit,
    onForm: (JsonValue) -> Unit,
) {
    // Keyed on the questions too: an agent can correct an open card, keeping its id, and it starts over.
    val picked = remember(id, questions) { mutableStateListOf(*Array(questions.size) { emptyList<String>() }) }
    val words = remember(id, questions) { mutableStateListOf(*Array(questions.size) { "" }) }
    val open = remember(id, questions) { mutableStateListOf(*Array(questions.size) { typed && answersInPlace }) }
    // Only an open text box answers its question.
    val answers = questions.indices.map { if (open[it]) words[it].trim() else "" }
    val complete = questions.indices.all { picked[it].isNotEmpty() || answers[it].isNotEmpty() }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        questions.forEachIndexed { index, item ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (questions.size > 1) Text(item.question, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                item.options.orEmpty().forEach { option ->
                    val on = option in picked[index]
                    val tag = Modifier.testTag("bot-question-option").semantics { if (pick) selected = on }
                    when {
                        !pick -> OutlinedButton(onClick = { onAnswer(option) }, modifier = tag) { Text(option) }
                        on -> FilledTonalButton(onClick = { picked[index] = picked[index] - option }, modifier = tag) {
                            Icon(Icons.Filled.Check, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(option)
                        }
                        else -> OutlinedButton(onClick = {
                            picked[index] = if (item.multiSelect == true) picked[index] + option else listOf(option)
                        }, modifier = tag) { Text(option) }
                    }
                }
                if (open[index]) OutlinedTextField(words[index], { words[index] = it }, Modifier.fillMaxWidth().testTag("bot-question-answer"),
                    placeholder = { Text(stringResource(R.string.chats_question_your_answer)) }, textStyle = MaterialTheme.typography.bodyMedium)
                else if (typed) TextButton(onClick = { open[index] = true }, Modifier.testTag("bot-question-other")) {
                    Text(stringResource(if (item.options.isNullOrEmpty()) R.string.chats_question_reply else R.string.chats_question_other))
                }
            }
        }
        if (pick || open.any { it }) Button(
            onClick = { if (pick) onForm(BotQuestion.formAnswer(questions, picked.toList(), answers)) else onAnswer(answers[0]) },
            enabled = if (pick) complete else answers[0].isNotEmpty(),
            modifier = Modifier.testTag("bot-question-send"),
        ) { Text(stringResource(R.string.chats_question_send_answer)) }
    }
}

@Composable
private fun heading(category: String?): String = stringResource(when (category) {
    "approval" -> R.string.chats_question_heading_approval
    "preference" -> R.string.chats_question_heading_preference
    "credential" -> R.string.chats_question_heading_credential
    "integration" -> R.string.chats_question_heading_integration
    "risk_tradeoff" -> R.string.chats_question_heading_tradeoff
    else -> R.string.chats_question_heading_decision
})
