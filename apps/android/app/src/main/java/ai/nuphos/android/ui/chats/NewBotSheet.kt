package ai.nuphos.android.ui.chats

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ai.nuphos.android.data.ConversationActions
import ai.nuphos.android.model.BotAvatars
import ai.nuphos.android.ui.components.BotFace

/**
 * "+" on Bots: a name and a face. It stays open, with what was picked, until the Bot's chat opens.
 * Once the Bot exists and only its chat is left to make, what was picked can't change any more.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun NewBotSheet(
    creating: Boolean,
    error: String?,
    botExists: Boolean,
    onCreate: (title: String, avatar: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var face by rememberSaveable { mutableStateOf(BotAvatars.files.random()) }
    val valid = ConversationActions.validTitle(name) != null
    val nameFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { nameFocus.requestFocus() }
    val latestCreating by rememberUpdatedState(creating)
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { it != SheetValue.Hidden || !latestCreating })
    ModalBottomSheet(onDismissRequest = { if (!creating) onDismiss() }, sheetState = sheet, modifier = Modifier.testTag("new-bot-sheet")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onDismiss, enabled = !creating) { Text("Cancel") }
            Text("New Bot", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            TextButton(onClick = { onCreate(name.trim(), face.removeSuffix(".svg")) }, enabled = valid && !creating) {
                if (creating) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("Create")
            }
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            BotFace(face, 88.dp)
            OutlinedTextField(name, { name = it }, Modifier.fillMaxWidth().focusRequester(nameFocus).testTag("new-bot-name"), enabled = !botExists && !creating,
                label = { Text("Name") }, singleLine = true,
                isError = name.trim().length > 120,
                supportingText = if (name.trim().length > 120) ({ Text("Use 120 characters or fewer.") }) else null)
            // Deliberately said here, which iOS doesn't do: this is a lot to give something new.
            Text("A new Bot starts with full access, so it can act without asking first.",
                Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            error?.let { Text(it, Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                BotAvatars.files.forEach { option ->
                    val selected = option == face
                    Box(Modifier.size(48.dp).clip(CircleShape)
                        .border(2.dp, if (selected) MaterialTheme.colorScheme.onSurface else Color.Transparent, CircleShape)
                        .clickable(enabled = !botExists && !creating, role = Role.RadioButton) { face = option }
                        .testTag("new-bot-face:${option.removeSuffix(".svg")}")
                        .semantics { contentDescription = faceName(option); this.selected = selected },
                        contentAlignment = Alignment.Center) { BotFace(option, 40.dp) }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** `05-rembrandt.svg` as a screen reader should say it. */
private fun faceName(file: String) = file.removeSuffix(".svg").substringAfter('-').replace('-', ' ')
    .replaceFirstChar { it.uppercase() }
