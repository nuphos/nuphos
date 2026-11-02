package ai.nuphos.android.ui.chat

import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ai.nuphos.android.model.ChatRow

/** Follow content only while the reader is at the end or explicitly asks for it. */
@Composable
internal fun TranscriptList(
    rows: List<ChatRow>,
    latestRequest: Int,
    modifier: Modifier = Modifier,
    state: LazyListState = rememberLazyListState(),
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
    Column(modifier) {
        LazyColumn(
            state = state,
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("transcript-list"),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(rows, key = { it.id }) { row -> content(row) }
        }
        if (!following) {
            TextButton(onClick = { following = true; jumpRequest++ }, modifier = Modifier.fillMaxWidth()) {
                Text("Jump to latest")
            }
        }
    }
}
