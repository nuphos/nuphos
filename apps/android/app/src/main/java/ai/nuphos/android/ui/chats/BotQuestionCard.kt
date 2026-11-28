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
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import ai.nuphos.android.session.DISMISS_REASON_LIMIT
import ai.nuphos.android.session.SnoozePreset
import ai.nuphos.android.session.snoozeTimes
import java.time.Instant
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.runtime.remember
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Button
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.runtime.setValue
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.DecisionQuestion
import ai.nuphos.android.session.BotQuestion
import ai.nuphos.android.session.FormEntry
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.unit.sp
import ai.nuphos.android.ui.components.MarkdownText
import androidx.compose.foundation.layout.heightIn
import androidx.compose.ui.draw.clipToBounds
import ai.nuphos.android.R
import androidx.compose.ui.res.stringResource

/**
 * An open question, in a Bot's chat or the Inbox, like Desktop's decision card: which agent asked,
 * the question and what the agent wrote to decide it from, each option an answer, and "Other…" to
 * type the answer in the card (in the Inbox, [answersInPlace], the text box is always there). A card
 * with several questions or any number of picks is a form ([QuestionForm]), sent once as [onForm]. An answer
 * wakes the agent that asked; no message is sent. A connect question opens the asking conversation's
 * credential picker ([onConnect]); a secret one, its secure input. [showsFrom] is off for the Bot's own
 * questions in its own chat. Snooze and Dismiss end the row of options (a form's footer), the same pill: Dismiss closes it
 * unanswered, in the Inbox with a reason for the agent ([asksReason]); Snooze, only in the Inbox, sets it
 * aside until one of [snoozeTimes]. Outside the Inbox, [ChatQuestionHead] leads the card instead (#2879).
 */
@OptIn(ExperimentalLayoutApi::class)
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
    /** A single question's text box is always on the card, rather than behind "Other…", as the Inbox shows it. */
    answersInPlace: Boolean = false,
    /** A several-question or multi-select card's answer, as its form builds it. */
    onForm: (JsonValue) -> Unit = {},
    /** Closes the question unanswered, with the reason typed when [asksReason]; absent where it cannot. */
    onDismiss: ((String?) -> Unit)? = null,
    asksReason: Boolean = false,
    /** Sets the question aside until a time; only the Inbox offers it. */
    onSnooze: ((Instant) -> Unit)? = null,
) {
    // In a chat or a Task, #2879's head leads the card. The Inbox, which alone answers in place and snoozes, keeps its own.
    val chat = !answersInPlace && onSnooze == null
    val replies = cardReplies(question)
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).testTag("bot-question"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (showsFrom && !chat) Row(Modifier.clickable(onClick = onOpen).testTag("bot-question-from"), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.chats_question_from, question.title), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (chat) ChatQuestionHead(question, showsFrom, onOpen, onLink)
                else {
                // One line, cut with an ellipsis, as on Desktop and iOS; a tap shows it in full.
                var open by rememberSaveable(question.id) { mutableStateOf(false) }
                Text(question.request.question, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface, maxLines = if (open) Int.MAX_VALUE else 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { open = !open }.semantics { heading() }.testTag("bot-question-title"))
                Text(categoryLabel(question.request.category), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.testTag("bot-question-category"))
                question.ownBody?.let { QuestionBody(question.id, it, onLink) }
                }
                val form = question.form
                val secret = question.secretPart
                // Asked for Dismiss's reason: the field under the row, and Dismiss is its send button.
                var dismissing by rememberSaveable(question.id) { mutableStateOf(false) }
                // Kept while the field is put away, so Dismiss again finds what was typed.
                var reason by rememberSaveable(question.id) { mutableStateOf("") }
                val asides: @Composable () -> Unit = {
                    SetAside(onDismiss.takeUnless { dismissing }, asksReason, onSnooze) { dismissing = true }
                }
                if (form != null) QuestionForm(question.id, form, onForm, asides)
                else if (replies != null && secret == null) QuestionOptions(question.id, DecisionQuestion(question.request.question, replies.map { it.second }),
                    question.typed, answersInPlace, onAnswer, asides)
                else {
                    if (secret != null) AskedSecretCard(question, secret)
                    else {
                        val own = question.personalCredentials?.map { if (it == "github") "GitHub" else if (it == "linear") "Linear" else it }
                            ?.foldIndexed("") { index, all, name -> if (index == 0) name else stringResource(R.string.chats_question_credentials_and, all, name) }
                        OutlinedButton(onClick = onConnect, modifier = Modifier.testTag("bot-question-connect")) {
                            Text(own?.let { stringResource(R.string.chats_question_use_own, it) } ?: stringResource(R.string.chats_question_choose_credentials))
                        }
                    }
                    if (onDismiss != null || onSnooze != null) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { asides() }
                }
                if (dismissing && onDismiss != null) DismissReason(reason, { reason = it }, onDismiss) { dismissing = false }
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

/** More than about four lines of text, as #2879 cuts the body: shown collapsed until asked for. */
internal fun isLongBody(text: String): Boolean = text.trim().lines().size > 4 || text.length > 240

/** One (label, reply) per option, possibly none; null for a secret or a connection, answered in their own way. */
internal fun cardReplies(question: BotQuestion): List<Pair<String, String>>? {
    val request = question.request
    if (request.secretName != null || question.connectable) return null
    return request.options.orEmpty().filter { it.isNotBlank() }.map { it to it }
}

/**
 * One single-choice question's options, as Desktop's `DecisionOptions`: each option answers it, and
 * "Other…", for the answer in words, ends one wrapping row of the same pill (in the Inbox,
 * [answersInPlace], the text box is already there), then "Send answer" for those words.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionOptions(
    id: String,
    question: DecisionQuestion,
    typed: Boolean,
    answersInPlace: Boolean,
    onAnswer: (String) -> Unit,
    /** Ends the row: Snooze and Dismiss. */
    trailing: @Composable () -> Unit,
) {
    // What is typed, and whether the box is open, outlive a rotation or the process, as the composer's draft does.
    var words by rememberSaveable(id, question) { mutableStateOf("") }
    var open by rememberSaveable(id, question) { mutableStateOf(typed && answersInPlace) }
    val answer = words.trim()
    // Send, from its button or the keyboard's return key.
    val send = { if (answer.isNotEmpty()) onAnswer(answer) }
    val aboveKeyboard = rememberAboveKeyboard()
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            question.options.orEmpty().forEach { option ->
                QuestionPill(option, checked = null, Modifier.testTag("bot-question-option")) { onAnswer(option) }
            }
            if (typed && !open) QuestionPill(
                stringResource(if (question.options.isNullOrEmpty()) R.string.chats_question_reply else R.string.chats_question_other),
                checked = null, Modifier.testTag("bot-question-other"),
            ) { open = true }
            trailing()
        }
        // One line, so the return key sends, as iOS's: a multi-line box takes it as a new line (#5112).
        if (open) {
            OutlinedTextField(words, { words = it }, Modifier.fillMaxWidth().then(aboveKeyboard.field).testTag("bot-question-answer"),
                placeholder = { Text(stringResource(R.string.chats_question_your_answer)) }, textStyle = MaterialTheme.typography.bodyMedium,
                singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { send() }))
            Button(
                onClick = send,
                enabled = answer.isNotEmpty(),
                modifier = aboveKeyboard.buttons.testTag("bot-question-send"),
                // The row's one ink button, the pills' radius, as Desktop and iOS draw Send.
                shape = RoundedCornerShape(9.dp),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.onSurface,
                    contentColor = MaterialTheme.colorScheme.surface),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            ) { Text(stringResource(R.string.chats_question_send_answer)) }
        }
    }
}

/**
 * A multi-select question, or several, as one form (#5257): each question picks its options or
 * "Other" with its words under them, numbered when there are several, and one footer ends the card:
 * Snooze and Dismiss, then "Answer N more" until every question is answered, and Send.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuestionForm(
    id: String,
    questions: List<DecisionQuestion>,
    onForm: (JsonValue) -> Unit,
    /** Leads the footer: Snooze and Dismiss. */
    asides: @Composable () -> Unit,
) {
    // Keyed on the questions too: an agent can correct an open card, keeping its id, and it starts over.
    val entries = rememberSaveable(id, questions, saver = formSaver) { questions.map { FormEntry.start(it) }.toMutableStateList() }
    val left = BotQuestion.unanswered(entries)
    // Send, from its button or a field's return key, once every question is answered.
    val send = { if (left == 0) onForm(BotQuestion.formAnswer(entries.toList())) }
    val aboveKeyboard = rememberAboveKeyboard()
    Column(verticalArrangement = Arrangement.spacedBy(20.dp)) {
        questions.forEachIndexed { index, item ->
            val entry = entries[index]
            Column {
                if (questions.size > 1) {
                    FormQuestionHead(index, item, entry.answered)
                    Spacer(Modifier.height(10.dp))
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item.options.orEmpty().forEach { option ->
                        QuestionPill(option, checked = option in entry.picked, Modifier.testTag("bot-question-option")) {
                            entries[index] = entries[index].toggle(option, item.multiSelect == true)
                        }
                    }
                    // With nothing to pick, the question is its field alone.
                    if (!item.options.isNullOrEmpty()) {
                        QuestionPill(stringResource(if (entry.other) R.string.chats_question_other_picked else R.string.chats_question_other),
                            checked = entry.other, Modifier.testTag("bot-question-other")) { entries[index] = entries[index].toggleOther() }
                    }
                }
                if (entry.other) {
                    Spacer(Modifier.height(8.dp))
                    // No send arrow of its own: return sends the card, once it is complete.
                    OutlinedTextField(entry.words, { entries[index] = entries[index].copy(words = it) },
                        Modifier.fillMaxWidth().then(aboveKeyboard.field).testTag("bot-question-answer"),
                        placeholder = { Text(stringResource(R.string.chats_question_your_answer)) }, textStyle = MaterialTheme.typography.bodyMedium,
                        singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { send() }))
                }
            }
        }
        Row(Modifier.fillMaxWidth().then(aboveKeyboard.buttons), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            asides()
            Spacer(Modifier.weight(1f))
            // Disabled, it counts what is left on the sunken fill; a tap on it does nothing.
            Button(
                onClick = send,
                enabled = left == 0,
                modifier = Modifier.testTag("bot-question-send"),
                shape = RoundedCornerShape(9.dp),
                colors = formSendColors(),
                border = if (left == 0) null else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(if (left == 0) stringResource(R.string.send)
                    else pluralStringResource(R.plurals.chats_question_answer_more, left, left))
            }
        }
    }
}

/**
 * A form question's head when there are several: a numbered ring, a filled check once answered, the
 * question, and "Choose any" for a multi-select.
 */
@Composable
private fun FormQuestionHead(index: Int, question: DecisionQuestion, answered: Boolean) {
    val heading = MaterialTheme.colorScheme.onSurface
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(verticalAlignment = Alignment.CenterVertically) {
        val marker = Modifier.size(20.dp).testTag("bot-question-marker").semantics { selected = answered }
        if (answered) Box(marker.background(heading, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Check, null, Modifier.size(12.dp), tint = MaterialTheme.colorScheme.surface)
        } else Box(marker.border(1.5.dp, heading.copy(alpha = 0.28f), CircleShape), contentAlignment = Alignment.Center) {
            Text("${index + 1}", color = muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, lineHeight = 11.sp)
        }
        Spacer(Modifier.width(10.dp))
        Text(question.question, Modifier.weight(1f), color = heading, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        if (question.multiSelect == true) Text(stringResource(R.string.chats_question_choose_any), Modifier.padding(start = 8.dp),
            color = muted, fontSize = 13.sp)
    }
}

/** The form's ink Send; disabled, iOS's sunken fill (secondaryContainer is its colour) and muted words. */
@Composable
private fun formSendColors() = ButtonDefaults.buttonColors(
    containerColor = MaterialTheme.colorScheme.onSurface, contentColor = MaterialTheme.colorScheme.surface,
    disabledContainerColor = MaterialTheme.colorScheme.secondaryContainer, disabledContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
)

/** A form's entries kept by [rememberSaveable]: three values each, which a Bundle holds. */
@Suppress("UNCHECKED_CAST")
private val formSaver = listSaver<SnapshotStateList<FormEntry>, Any>(
    save = { entries -> entries.flatMap { listOf(ArrayList(it.picked), it.other, it.words) } },
    restore = { values ->
        values.chunked(3).map { (picked, other, words) ->
            FormEntry(picked as List<String>, other as Boolean, words as String)
        }.toMutableStateList()
    },
)

/**
 * Snooze and Dismiss, the same pill as the options. Snooze opens its preset times; Dismiss either closes
 * the question at once, or first asks for an optional reason for the agent ([onAskReason]).
 */
@Composable
private fun SetAside(onDismiss: ((String?) -> Unit)?, asksReason: Boolean, onSnooze: ((Instant) -> Unit)?, onAskReason: () -> Unit) {
    if (onSnooze != null) Box {
        var menu by remember { mutableStateOf(false) }
        QuestionPill(stringResource(R.string.chats_question_snooze), checked = null, Modifier.testTag("bot-question-snooze")) { menu = true }
        DropdownMenu(menu, { menu = false }) {
            snoozeTimes().forEach { (preset, until) ->
                DropdownMenuItem(text = { Text(stringResource(when (preset) {
                    SnoozePreset.Hour -> R.string.chats_question_snooze_hour
                    SnoozePreset.Tomorrow -> R.string.chats_question_snooze_tomorrow
                    SnoozePreset.NextMonday -> R.string.chats_question_snooze_monday
                })) }, onClick = { menu = false; onSnooze(until) }, modifier = Modifier.testTag("bot-question-snooze-time"))
            }
        }
    }
    if (onDismiss != null) QuestionPill(stringResource(R.string.chats_question_dismiss), checked = null, Modifier.testTag("bot-question-dismiss")) {
        if (asksReason) onAskReason() else onDismiss(null)
    }
}

/** Dismiss's optional reason for the agent, under the row, sent with Dismiss or put away with Cancel. */
@Composable
private fun DismissReason(reason: String, onReason: (String) -> Unit, onDismiss: (String?) -> Unit, onCancel: () -> Unit) {
    val aboveKeyboard = rememberAboveKeyboard()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // One line, and return dismisses with it, as iOS's and as Dismiss beside it (#5112).
        OutlinedTextField(reason, { onReason(it.take(DISMISS_REASON_LIMIT)) }, Modifier.fillMaxWidth().then(aboveKeyboard.field).testTag("bot-question-dismiss-reason"),
            label = { Text(stringResource(R.string.chats_question_dismiss_reason)) }, textStyle = MaterialTheme.typography.bodyMedium,
            singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { onDismiss(reason) }))
        Row(Modifier.fillMaxWidth().then(aboveKeyboard.buttons), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel)) }
            Button(onClick = { onDismiss(reason) }, modifier = Modifier.testTag("bot-question-dismiss-send")) {
                Text(stringResource(R.string.chats_question_dismiss))
            }
        }
    }
}

/** A text field's modifier, and its buttons' below it: they stay above the keyboard as it opens on a short screen. */
private class AboveKeyboard(val field: Modifier, val buttons: Modifier)

@Composable
private fun rememberAboveKeyboard(): AboveKeyboard {
    val requester = remember { BringIntoViewRequester() }
    var typing by remember { mutableStateOf(false) }
    val keyboard = WindowInsets.ime.getBottom(LocalDensity.current)
    LaunchedEffect(typing, keyboard) { if (typing && keyboard > 0) requester.bringIntoView() }
    return AboveKeyboard(Modifier.onFocusChanged { typing = it.isFocused }, Modifier.bringIntoViewRequester(requester))
}

/**
 * An option, the same pill for every one as Paper draws it: the raised surface with a hairline ring
 * and a soft shadow, radius 9, hugging its words. [checked], it is picked rather than sent: a check
 * once picked.
 */
@Composable
private fun QuestionPill(title: String, checked: Boolean?, modifier: Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = RoundedCornerShape(9.dp), color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), shadowElevation = 1.dp,
        modifier = modifier.semantics { if (checked != null) selected = checked }) {
        Row(Modifier.heightIn(min = 40.dp).padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (checked == true) Icon(Icons.Filled.Check, null, Modifier.size(16.dp))
            Text(title, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun categoryLabel(category: String?): String = stringResource(when (category) {
    "approval" -> R.string.chats_question_heading_approval
    "preference" -> R.string.chats_question_heading_preference
    "credential" -> R.string.chats_question_heading_credential
    "integration" -> R.string.chats_question_heading_integration
    "risk_tradeoff" -> R.string.chats_question_heading_tradeoff
    else -> R.string.chats_question_heading_decision
})
