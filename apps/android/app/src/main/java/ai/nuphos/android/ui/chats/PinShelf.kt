package ai.nuphos.android.ui.chats

import ai.nuphos.android.R
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.ui.components.AgentAvatar
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
internal fun pinActionLabel(row: AgentConversation, pinned: Boolean): String = stringResource(
    if (row.isBot || row.botId != null) {
        if (pinned) R.string.pins_unpin_bot else R.string.pins_pin_bot
    } else if (pinned) R.string.pins_unpin else R.string.pins_pin)

@Composable
internal fun PinAction(row: AgentConversation, pinned: Boolean, enabled: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(pinActionLabel(row, pinned)) }, enabled = enabled,
        leadingIcon = { Icon(painterResource(if (pinned) R.drawable.bot_pin_off else R.drawable.bot_pin), null) },
        modifier = Modifier.testTag("pin-action:${row.sessionId}"), onClick = onClick)
}

/** Constrain both shelf and list previews to the list's horizontal inset. */
@Composable
internal fun BotPreviewMenu(expanded: Boolean, onDismissRequest: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    if (!expanded) return
    val inset = with(LocalDensity.current) { 16.dp.roundToPx() }
    val position = remember(inset) { object : PopupPositionProvider {
        override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize,
            layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
            val x = (if (layoutDirection == LayoutDirection.Ltr) anchorBounds.left else anchorBounds.right - popupContentSize.width)
                .coerceIn(inset, (windowSize.width - popupContentSize.width - inset).coerceAtLeast(inset))
            val y = (if (anchorBounds.bottom + popupContentSize.height <= windowSize.height - inset)
                anchorBounds.bottom else anchorBounds.top - popupContentSize.height)
                .coerceIn(inset, (windowSize.height - popupContentSize.height - inset).coerceAtLeast(inset))
            return IntOffset(x, y)
        }
    } }
    Popup(popupPositionProvider = position, onDismissRequest = onDismissRequest,
        properties = PopupProperties(focusable = true)) {
        Surface(shape = MaterialTheme.shapes.extraSmall, tonalElevation = 3.dp, shadowElevation = 8.dp) {
            Column(Modifier.width(minOf(320.dp, (LocalConfiguration.current.screenWidthDp - 32).coerceAtLeast(1).dp))
                .verticalScroll(rememberScrollState()).padding(vertical = 8.dp), content = content)
        }
    }
}

/** A snapshot only: rendering a context preview never opens, polls or marks a chat read. */
@Composable
internal fun BotConversationPreview(row: AgentConversation) {
    val title = if (row.isChannel) row.displayTitleForChat else row.displayTitle
    Column(Modifier.fillMaxWidth().testTag("bot-conversation-preview")) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (row.isChannel) ChatIcon(row.faces.orEmpty(), title, 36.dp)
            else AgentAvatar(row.sessionId, row.agentRuntime, 36.dp)
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        HorizontalDivider()
        val message = row.previewLine?.takeIf { it.isNotBlank() }
        Box(Modifier.padding(16.dp)) {
            Text(message ?: stringResource(R.string.pins_no_messages),
                if (message == null) Modifier.fillMaxWidth() else Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.10f)).padding(16.dp),
                style = MaterialTheme.typography.bodyMedium, maxLines = 8, overflow = TextOverflow.Ellipsis)
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun PinShelf(rows: List<AgentConversation>, status: (AgentConversation) -> PinStatus?,
    enabled: Boolean, onOpen: (AgentConversation) -> Unit, onUnpin: (AgentConversation) -> Unit) {
    LazyRow(Modifier.fillMaxWidth().testTag("pinned-bots-shelf"),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally)) {
        items(rows, key = { it.sessionId }) { row ->
            val title = if (row.isChannel) row.displayTitleForChat else row.displayTitle
            val state = status(row)
            val label = state?.let { stringResource(it.label) }.orEmpty()
            var menu by remember(row.sessionId) { mutableStateOf(false) }
            Box {
                Column(Modifier.width(76.dp).heightIn(min = 100.dp)
                    .combinedClickable(onClick = { onOpen(row) }, onLongClick = { menu = true },
                        onLongClickLabel = stringResource(R.string.chats_more_actions))
                    .testTag("pinned-bot:${row.sessionId}")
                    .semantics(mergeDescendants = true) { contentDescription = listOf(title, label).filter { it.isNotBlank() }.joinToString(", ") },
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box {
                        if (row.isChannel) ChatIcon(row.faces.orEmpty(), title, 64.dp)
                        else AgentAvatar(row.sessionId, row.agentRuntime, 64.dp)
                        state?.let {
                            val color = when (it) {
                                PinStatus.Waiting -> MaterialTheme.colorScheme.error
                                PinStatus.Running -> MaterialTheme.colorScheme.tertiary
                                PinStatus.Unread -> MaterialTheme.colorScheme.primary
                            }
                            Box(Modifier.align(Alignment.TopEnd).size(10.dp).clip(CircleShape).background(color)
                                .testTag("pin-status:${row.sessionId}"))
                        }
                    }
                    Text(title, style = MaterialTheme.typography.labelSmall, maxLines = 2,
                        overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                }
                BotPreviewMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    BotConversationPreview(row)
                    PinAction(row, pinned = true, enabled = enabled) { menu = false; onUnpin(row) }
                }
            }
        }
    }
}

internal enum class PinStatus(val label: Int) {
    Waiting(R.string.pins_needs_input), Running(R.string.pins_running), Unread(R.string.pins_unread);
}

/** A Bot's open questions take priority over turns, including those of its dispatched Tasks. */
internal fun pinStatus(row: AgentConversation, agents: List<AgentConversation>): PinStatus? {
    val botId = if (row.isBot) row.sessionId else row.botId
    val family = if (botId == null) emptySet() else setOf(botId) +
        agents.filter { !it.isBot && it.parentSessionId == botId }.map { it.sessionId }
    val runs = (agents + row).filter { it.sessionId in family }.distinctBy { it.sessionId }
    if (runs.any { agent -> agent.inputRequests.orEmpty().any {
            agent.botOnboarding !in setOf("pending", "active") || it.category != "preference"
        } }) return PinStatus.Waiting
    if (runs.any {
        if (it.agentRuntime != null && it.agentRuntime != "nuphos")
            it.runtimeState?.get("state")?.stringValue == "active" && it.runtimeState["phase"]?.stringValue != "resume_disconnected"
        else it.activeRun != null
    }) return PinStatus.Running
    return PinStatus.Unread.takeIf { row.hasUnreadPosts() }
}
