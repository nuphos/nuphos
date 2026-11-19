package ai.nuphos.android.ui.chats

import ai.nuphos.android.R
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ChatTime
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.ui.chat.AskedSecretCard
import ai.nuphos.android.ui.components.AgentAvatar
import ai.nuphos.android.ui.components.MarkdownText
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant

/**
 * An open question in a Bot's chat or a Task (#2879), as Desktop #2887 and iOS #2886 draw it: who asked,
 * when it was another Bot or Task; the question as the heading; its body cut at four lines behind a
 * full-width Show more; full-width options, the first one primary; then Other… and Skip side by side.
 * Other… swaps that row for the answer field. A multi-select or several questions keep their form.
 */
@Composable
internal fun ChatQuestionCard(
    question: BotQuestion,
    onOpen: () -> Unit,
    onAnswer: (String) -> Unit,
    showsFrom: Boolean,
    onLink: ((String) -> Unit)?,
    failure: String?,
    onConnect: () -> Unit,
    onForm: (JsonValue) -> Unit,
    onDismiss: ((String?) -> Unit)?,
) {
    val card = MaterialTheme.colorScheme.surfaceContainerHigh
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag("bot-question"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Surface(shape = RoundedCornerShape(14.dp), color = card, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp)) {
                if (showsFrom) Source(question, onOpen)
                Text(question.request.question, Modifier.testTag("bot-question-heading"),
                    style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp, lineHeight = 22.sp), fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface)
                question.ownBody?.let { Spacer(Modifier.height(4.dp)); Body(question.id, it, card, onLink) }
                Spacer(Modifier.height(12.dp))
                val replies = cardReplies(question)
                val form = question.form
                val secret = question.secretPart
                val skip = onDismiss?.let { { it(null) } }
                when {
                    form != null -> {
                        QuestionOptions(question.id, form, pick = true, question.typed, answersInPlace = false, onAnswer, onForm) {}
                        skip?.let { Spacer(Modifier.height(8.dp)); AsideRow(other = null, skip = it) }
                    }
                    replies != null && secret == null -> Answers(question, replies.map { it.first }, onAnswer, skip)
                    else -> {
                        if (secret != null) AskedSecretCard(question, secret)
                        else {
                            val own = question.personalCredentials?.map { if (it == "github") "GitHub" else if (it == "linear") "Linear" else it }
                                ?.foldIndexed("") { index, all, name -> if (index == 0) name else stringResource(R.string.chats_question_credentials_and, all, name) }
                            OutlinedButton(onClick = onConnect, modifier = Modifier.testTag("bot-question-connect")) {
                                Text(own?.let { stringResource(R.string.chats_question_use_own, it) } ?: stringResource(R.string.chats_question_choose_credentials))
                            }
                        }
                        skip?.let { Spacer(Modifier.height(8.dp)); AsideRow(other = null, skip = it) }
                    }
                }
            }
        }
        if (failure != null) Text(stringResource(R.string.chats_question_send_failed, failure), Modifier.testTag("bot-question-failure"),
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    }
}

/** The Bot or Task that asked: its face, its name (which opens it) and when. */
@Composable
private fun Source(question: BotQuestion, onOpen: () -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.padding(bottom = 6.dp).clickable(onClick = onOpen).testTag("bot-question-from"),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        AgentAvatar(question.sessionId, null, 14.dp, showBadge = false)
        Text(question.title, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(12.dp), tint = muted)
        question.request.askedAt?.let { runCatching { Instant.parse(it) }.getOrNull() }?.let {
            Text(ChatTime.label(it), style = MaterialTheme.typography.labelMedium, color = muted, maxLines = 1)
        }
    }
}

/** Up to four lines, the last fading out, then a full-width Show more; a tap on the cut body opens it too. */
@Composable
private fun Body(id: String, text: String, card: Color, onLink: ((String) -> Unit)?) {
    val long = isLongBody(text)
    var expanded by rememberSaveable(id) { mutableStateOf(false) }
    val cut = long && !expanded
    Box {
        MarkdownText(text, (if (cut) Modifier.heightIn(max = 84.dp).clipToBounds().clickable { expanded = true } else Modifier)
            .testTag("bot-question-body"), onLink = onLink, compact = true)
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

/** Full-width options, the first one primary; then Other… and Skip, or the answer field once Other… is tapped. */
@Composable
private fun Answers(question: BotQuestion, options: List<String>, onAnswer: (String) -> Unit, skip: (() -> Unit)?) {
    var open by rememberSaveable(question.id) { mutableStateOf(false) }
    var words by rememberSaveable(question.id) { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEachIndexed { index, option ->
            val colors = if (index == 0) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface,
                contentColor = MaterialTheme.colorScheme.surface)
            else ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                contentColor = MaterialTheme.colorScheme.onSurface)
            Button(onClick = { onAnswer(option) }, Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("bot-question-option"),
                shape = RoundedCornerShape(22.dp), colors = colors) {
                Text(option, style = MaterialTheme.typography.labelLarge.copy(fontSize = 16.sp), fontWeight = FontWeight.SemiBold)
            }
        }
        if (open) AnswerField(words, { words = it }) { onAnswer(words.trim()) }
        else if (question.typed || skip != null) AsideRow(
            other = if (question.typed) stringResource(if (options.isEmpty()) R.string.chats_question_reply else R.string.chats_question_other) to { open = true } else null,
            skip = skip,
        )
    }
}

/** Other… and Skip: two outlined halves, 44dp high. */
@Composable
private fun AsideRow(other: Pair<String, () -> Unit>?, skip: (() -> Unit)?) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        other?.let { (label, onClick) -> Aside(label, Modifier.weight(1f).testTag("bot-question-other"), onClick) }
        skip?.let { Aside(stringResource(R.string.chats_question_skip), Modifier.weight(1f).testTag("bot-question-dismiss"), it) }
    }
}

@Composable
private fun Aside(label: String, modifier: Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = modifier.heightIn(min = 44.dp), shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Text(label, style = MaterialTheme.typography.labelLarge.copy(fontSize = 15.sp), fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface)
    }
}

/** The answer in words: a 44dp field and a round send button beside it. */
@Composable
private fun AnswerField(words: String, onWords: (String) -> Unit, onSend: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline), modifier = Modifier.weight(1f).heightIn(min = 44.dp)) {
            Box(Modifier.padding(horizontal = 16.dp, vertical = 11.dp), contentAlignment = Alignment.CenterStart) {
                if (words.isEmpty()) Text(stringResource(R.string.chats_question_your_answer), color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyLarge)
                BasicTextField(words, onWords, Modifier.fillMaxWidth().testTag("bot-question-answer"),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.onSurface))
            }
        }
        val ready = words.isNotBlank()
        FilledIconButton(onClick = onSend, enabled = ready, modifier = Modifier.size(44.dp).testTag("bot-question-send"), shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.onSurface,
                contentColor = MaterialTheme.colorScheme.surface)) {
            Icon(Icons.Outlined.ArrowUpward, stringResource(R.string.chats_question_send_answer), Modifier.size(22.dp))
        }
    }
}
