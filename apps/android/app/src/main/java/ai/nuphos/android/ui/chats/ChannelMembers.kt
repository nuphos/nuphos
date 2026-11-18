package ai.nuphos.android.ui.chats

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ai.nuphos.android.R
import ai.nuphos.android.model.BotPresence
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.ui.components.AgentAvatar

/** A group chat's Bots, each with whether it can reply now (#3308), as Desktop's member list shows them. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ChannelMembersSheet(agents: List<ChannelAgent>, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(Modifier.fillMaxWidth().testTag("members-sheet"), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text(stringResource(R.string.chats_members), style = MaterialTheme.typography.titleLarge) }
            items(agents, key = { it.sessionId }) { agent ->
                Row(Modifier.fillMaxWidth().testTag("member-row"), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    AgentAvatar(agent.sessionId, agent.provider, 28.dp)
                    Text(agent.title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    agent.presence?.let { PresenceTag(it) }
                }
            }
        }
    }
}

@Composable
private fun PresenceTag(presence: BotPresence) {
    val (tone, word) = presence.tag
    val color = when (tone) {
        BotPresence.Tone.Ready -> Color(0xFF2E7D32)
        BotPresence.Tone.Waiting -> Color(0xFFAF601A)
        BotPresence.Tone.Down -> MaterialTheme.colorScheme.error
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).background(color, CircleShape))
        Text(word, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
