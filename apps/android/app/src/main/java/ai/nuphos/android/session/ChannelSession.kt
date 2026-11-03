package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChannelPost
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

/**
 * A chat: people and agents talking. It runs no agent of its own; each agent
 * answers from its own session. Read the same way as Desktop and iOS: a cheap
 * `tail=1` probe, and the full read only when the chat changed.
 */
class ChannelSession(
    val teamId: String,
    val channelId: String,
    title: String,
    private val transport: Transport,
) {
    interface Transport {
        suspend fun detail(tail: Int): AgentConversationDetail
        suspend fun agents(): List<ChannelAgent>
        suspend fun attachment(groupId: String): TransferDownloadGroup
    }

    class Api(private val token: String, private val teamId: String, private val channelId: String) : Transport {
        override suspend fun detail(tail: Int) = NuphosApi.conversationDetail(token, teamId, channelId, tail)
        override suspend fun agents() = NuphosApi.channelAgents(token, teamId, channelId)
        override suspend fun attachment(groupId: String) = NuphosApi.channelAttachment(token, teamId, channelId, groupId)
    }

    var title by mutableStateOf(title)
        private set
    var stored by mutableStateOf<List<ChannelPost>>(emptyList())
        private set
    var events by mutableStateOf<List<AgentConversationDetail.TimelineEvent>>(emptyList())
        private set
    var agents by mutableStateOf<List<ChannelAgent>>(emptyList())
        private set
    var readOnly by mutableStateOf(false)
        private set
    var loaded by mutableStateOf(false)
        private set
    var loadError by mutableStateOf<String?>(null)
        private set
    /** The newest activity this chat reported, for its read marker. */
    var activitySeq by mutableStateOf<Long?>(null)
        private set
    private var revision = ""

    val posts: List<ChannelPost> get() = stored

    /** The probe, then the full read when the chat changed; `force` skips the probe. */
    suspend fun refresh(force: Boolean = false) {
        try {
            if (!force && loaded) {
                val probe = transport.detail(1)
                if (stamp(probe) == revision) return
            }
            coroutineScope {
                val detail = async { transport.detail(TAIL) }
                val listed = async { transport.agents() }
                val read = detail.await()
                apply(read, listed.await())
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (!loaded) { loadError = "Couldn't load this chat."; loaded = true }
        }
    }

    /** Until cancelled, while the chat is on screen. */
    suspend fun poll() {
        refresh(force = !loaded)
        while (true) {
            delay(POLL_MS)
            refresh()
        }
    }

    /** A posted file group, read when its card shows; a failed read is never cached, so the card can retry. */
    suspend fun transferGroup(groupId: String): TransferDownloadGroup = transport.attachment(groupId)

    private fun stamp(detail: AgentConversationDetail) = "${detail.transcriptUpdatedAt.orEmpty()}:${detail.messageCount ?: detail.messages.size}"

    private fun apply(detail: AgentConversationDetail, listed: List<ChannelAgent>) {
        stored = detail.messages.mapNotNull(ChannelPost::from)
        events = detail.timelineEvents
        agents = listed
        readOnly = detail.readOnly == true
        detail.title?.takeIf { it.isNotBlank() }?.let { title = it }
        activitySeq = detail.activitySeq?.numberValue?.toLong()
        revision = stamp(detail)
        loadError = null
        loaded = true
    }

    companion object {
        const val TAIL = 200
        const val POLL_MS = 4_000L
    }
}
