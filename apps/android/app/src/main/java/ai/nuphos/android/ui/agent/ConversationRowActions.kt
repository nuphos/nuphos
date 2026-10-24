package ai.nuphos.android.ui.agent

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlin.math.roundToInt

internal data class ConversationRowAction(
    val id: String,
    val label: String,
    val icon: ImageVector,
    val enabled: Boolean = true,
    val invoke: () -> Unit,
)

/** Owned by the list, not by recycled items. Never stores a business operation. */
@Stable
internal class ConversationRowInteractions {
    var revealedId by mutableStateOf<String?>(null)
        private set
    var menuId by mutableStateOf<String?>(null)
        private set
    var bounds: Rect? = null
    fun reveal(id: String) { revealedId = id; menuId = null }
    fun menu(id: String) { revealedId = null; menuId = id }
    fun dismiss() { revealedId = null; menuId = null; bounds = null }
}

@Composable
internal fun Modifier.dismissRowActionsOnOutsidePress(interactions: ConversationRowInteractions): Modifier {
    var origin by remember { mutableStateOf(Offset.Zero) }
    return onGloballyPositioned { origin = it.positionInRoot() }.pointerInput(interactions) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            if (interactions.revealedId != null && interactions.bounds?.contains(down.position + origin) != true) {
                interactions.dismiss()
            }
        }
    }
}

private enum class Reveal { Closed, Open }

/** Two anchors reveal buttons. Swiping, including a full fling, never invokes an action. */
@Composable
internal fun ConversationRowActions(
    id: String,
    actions: List<ConversationRowAction>,
    interactions: ConversationRowInteractions,
    onClick: () -> Unit,
    content: @Composable (Modifier, @Composable () -> Unit) -> Unit,
) {
    val drag = remember(id) { AnchoredDraggableState(Reveal.Closed) }
    val source = remember(id) { MutableInteractionSource() }
    val dragging by source.collectIsDraggedAsState()
    val density = LocalDensity.current
    val moreFocus = remember(id) { FocusRequester() }
    val active = interactions.revealedId == id
    val menuOpen = interactions.menuId == id
    val latestActive by rememberUpdatedState(active)
    val latestDragging by rememberUpdatedState(dragging)
    val latestActions by rememberUpdatedState(actions)
    DisposableEffect(id, interactions) {
        onDispose {
            if (interactions.revealedId == id || interactions.menuId == id) interactions.dismiss()
        }
    }
    fun dismissMenu() {
        interactions.dismiss()
        runCatching { moreFocus.requestFocus() }
    }
    BackHandler(active || menuOpen) { dismissMenu() }
    LaunchedEffect(dragging) { if (dragging) interactions.reveal(id) }
    LaunchedEffect(active, dragging) { if (!active && !dragging) drag.animateTo(Reveal.Closed) }
    LaunchedEffect(drag) {
        snapshotFlow { drag.settledValue }.distinctUntilChanged().collect {
            if (it == Reveal.Closed && latestActive && !latestDragging) interactions.dismiss()
        }
    }
    BoxWithConstraints(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large)
        .onGloballyPositioned { if (active || menuOpen) interactions.bounds = it.boundsInRoot() }) {
        // Icons retain 48dp targets. Large text/narrow nested rows use two actions + More.
        val compact = maxWidth < 360.dp || density.fontScale > 1.3f
        val shown = if (compact && actions.size > 3) actions.take(2) else actions
        val hasMore = shown.size < actions.size
        val width = (48 * (shown.size + if (hasMore) 1 else 0)).dp
        val widthPx = with(density) { width.toPx() }
        SideEffect {
            drag.updateAnchors(DraggableAnchors { Reveal.Closed at 0f; Reveal.Open at -widthPx })
        }
        if (active) Row(Modifier.align(Alignment.CenterEnd).width(width).heightIn(min = 48.dp)
            .testTag("row-rail:$id"), horizontalArrangement = Arrangement.End) {
            shown.forEach { action ->
                IconButton(enabled = action.enabled, onClick = {
                    val current = latestActions.firstOrNull { it.id == action.id && it.enabled }
                    interactions.dismiss()
                    current?.invoke?.invoke()
                }, modifier = Modifier.size(48.dp).testTag("rail-${action.id}:$id")) {
                    Icon(action.icon, action.label)
                }
            }
            if (hasMore) IconButton(onClick = { interactions.menu(id) }, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Outlined.MoreVert, "More agent actions")
            }
        }
        val surface = Modifier.offset { IntOffset((drag.offset.takeUnless { it.isNaN() } ?: 0f).roundToInt(), 0) }
            .anchoredDraggable(drag, Orientation.Horizontal, interactionSource = source, enabled = actions.isNotEmpty())
            .combinedClickable(
                onClick = { if (interactions.revealedId != null) interactions.dismiss() else onClick() },
                onLongClickLabel = "Show agent actions",
                onLongClick = { interactions.menu(id) },
            )
            .semantics {
                customActions = actions.filter { it.enabled }.map { action ->
                    CustomAccessibilityAction(action.label) {
                        interactions.dismiss()
                        latestActions.firstOrNull { it.id == action.id && it.enabled }?.invoke?.invoke()
                        true
                    }
                }
            }.testTag("conversation-row:$id")
        content(surface) {
            IconButton(onClick = { interactions.menu(id) }, modifier = Modifier.size(48.dp)
                .focusRequester(moreFocus).testTag("row-more:$id")) {
                Icon(Icons.Outlined.MoreVert, "Agent actions")
            }
        }
        Box(Modifier.align(Alignment.BottomEnd)) {
            DropdownMenu(expanded = menuOpen, onDismissRequest = ::dismissMenu) {
                actions.forEach { action ->
                    DropdownMenuItem(text = { Text(action.label) }, leadingIcon = { Icon(action.icon, null) },
                        enabled = action.enabled, onClick = {
                            val current = latestActions.firstOrNull { it.id == action.id && it.enabled }
                            dismissMenu()
                            current?.invoke?.invoke()
                        }, modifier = Modifier.testTag("menu-${action.id}:$id"))
                }
            }
        }
    }
}
