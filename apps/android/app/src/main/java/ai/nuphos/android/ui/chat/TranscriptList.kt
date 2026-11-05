package ai.nuphos.android.ui.chat

import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material3.Icon
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.ChatRow

/**
 * Follow content only while the reader is at the end or explicitly asks for it.
 * [bottomInset] is what the screen lays over the list's bottom edge: the last row and the button stay above it.
 */
@Composable
internal fun TranscriptList(
    rows: List<ChatRow>,
    latestRequest: Int,
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
    bottomInset: Dp = 0.dp,
    content: @Composable (ChatRow) -> Unit,
) {
    var following by remember(state) { mutableStateOf(true) }
    var autoScrolling by remember(state) { mutableStateOf(false) }
    var userScrolling by remember(state) { mutableStateOf(false) }
    var seenRequest by remember(state) { mutableStateOf(latestRequest) }
    var jumpRequest by remember(state) { mutableStateOf(0) }

    LaunchedEffect(state) {
        state.interactionSource.interactions.collect { interaction ->
            if (interaction is DragInteraction.Start) {
                userScrolling = true
                following = false
            }
        }
    }
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }.collect { scrolling ->
            if (scrolling && !autoScrolling) {
                userScrolling = true
                following = false
            } else if (!scrolling && userScrolling) {
                userScrolling = false
                following = !state.canScrollForward
            }
        }
    }
    val viewportEnd = state.layoutInfo.viewportEndOffset
    LaunchedEffect(rows, latestRequest, following, jumpRequest, viewportEnd) {
        if (latestRequest != seenRequest) {
            seenRequest = latestRequest
            following = true
        }
        if (following && rows.isNotEmpty()) {
            autoScrolling = true
            try {
                withFrameNanos { }
                state.scrollToItem(rows.lastIndex)
            } finally {
                autoScrolling = false
            }
        }
    }
    // Rows can grow after the initial jump (e.g. an inline plan finishes loading).
    // While still following, keep the latest row in view; a reader scroll stops following.
    val lastIndex by rememberUpdatedState(rows.lastIndex)
    LaunchedEffect(state) {
        snapshotFlow { following && !userScrolling && state.canScrollForward }
            .collect { behind ->
                if (behind && lastIndex >= 0) {
                    autoScrolling = true
                    try { state.scrollToItem(lastIndex) } finally { autoScrolling = false }
                }
            }
    }
    Box(modifier) {
        LazyColumn(
            state = state,
            modifier = Modifier.fillMaxSize().testTag("transcript-list"),
            contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 16.dp + bottomInset),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(rows, key = { it.id }) { row -> content(row) }
        }
        if (!following) SmallFloatingActionButton(
            onClick = { following = true; jumpRequest++ },
            // The button keeps a 48 dp touch target around its 40 dp circle, so this draws it 16 dp from the side and 12 dp up.
            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 8.dp + bottomInset)
                .semantics { contentDescription = "Scroll to latest" },
        ) { Icon(Icons.Outlined.ArrowDownward, null) }
    }
}
