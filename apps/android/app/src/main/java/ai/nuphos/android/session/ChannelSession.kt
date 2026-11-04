package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChatFace
import ai.nuphos.android.model.ChannelPost
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.AttachmentTransfers
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.model.ComposerAttachment
import ai.nuphos.android.model.ComposerSubmission

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
        /** Uploads a post's files to the transfer store and returns their group. */
        suspend fun upload(attachments: List<ComposerAttachment>): String
        /** `POST …/channel-messages` with `{text, id, upload}`; a repeated id is not posted twice. */
        suspend fun post(text: String, id: String, upload: String?)
    }

    class Api(private val token: String, private val teamId: String, private val channelId: String) : Transport {
        override suspend fun detail(tail: Int) = NuphosApi.conversationDetail(token, teamId, channelId, tail)
        override suspend fun agents() = NuphosApi.channelAgents(token, teamId, channelId)
        override suspend fun attachment(groupId: String) = NuphosApi.channelAttachment(token, teamId, channelId, groupId)
        private val transfers = AttachmentTransfers()
        override suspend fun upload(attachments: List<ComposerAttachment>): String {
            val pending = transfers.retain(attachments)
            return transfers.prepare(token, teamId, pending, allowed = { AiAccess.bind(token)() }).groupId
        }
        override suspend fun post(text: String, id: String, upload: String?) {
            val body = buildList {
                add("text" to JsonValue.Str(text)); add("id" to JsonValue.Str(id))
                if (upload != null) add("upload" to JsonValue.Str(upload))
            }
            AgentChatApi.send("POST", "agent/conversations/${android.net.Uri.encode(channelId)}/channel-messages", token,
                query = listOf("teamId" to teamId), body = JsonValue.obj(*body.toTypedArray()))
        }
    }

    var title by mutableStateOf(title)
        private set
    /** The chat's icon: the members other than the viewer that it shows. */
    var faces by mutableStateOf<List<ChatFace>>(emptyList())
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
    /** Bumped after every read of the chat, so a failed read marker retries with the next poll. */
    var reads by mutableStateOf(0L)
        private set
    private var markedSeq: Long? = null
        private set
    private var revision = ""

    /** Posts shown at once, until the chat returns them under the same id. */
    var sending by mutableStateOf<List<ChannelPost>>(emptyList())
        private set
    /** What a sending post attached, drawn from the device until it is posted. */
    var sendingAttachments by mutableStateOf<Map<String, List<ComposerAttachment>>>(emptyMap())
        private set
    /** A post that could not be sent goes back into the composer. */
    var unsent by mutableStateOf<ComposerSubmission?>(null)
    var sendError by mutableStateOf<String?>(null)
    /** The latest send, so the transcript returns to the end for it. */
    var lastSubmittedKey by mutableStateOf<String?>(null)
        private set
    /** A resend of the same post reuses its id, so a post that did land is not doubled. */
    private var retry: Pair<String, String>? = null

    val posts: List<ChannelPost> get() = stored + ChannelPost.stillSending(stored, sending)

    /** Shown at once; files upload first, then the post goes out with their group. */
    fun send(submission: ComposerSubmission, viewerId: String?, viewerName: String?, viewerAvatar: String?,
             scope: kotlinx.coroutines.CoroutineScope, allowed: () -> Boolean = { true },
             newId: () -> String = { java.util.UUID.randomUUID().toString().lowercase() }): Boolean {
        val text = submission.text.trim()
        if (readOnly || !allowed() || (text.isEmpty() && submission.attachments.isEmpty())) return false
        // The same post is the same words and the same attached files (their own ids, not their
        // names): a post put back after a failure keeps its id, while a newly picked file never does.
        val key = (listOf(text) + submission.attachments.map { it.id }).joinToString("\n")
        val id = retry?.takeIf { it.first == key }?.second ?: newId()
        retry = key to id
        sending = sending.filter { it.id != id } + ChannelPost(id, viewerId.orEmpty(), isAgent = false, name = viewerName ?: "You",
            avatarURL = viewerAvatar, text = text, sentAt = java.time.Instant.now(), sending = true)
        if (submission.attachments.isNotEmpty()) sendingAttachments = sendingAttachments + (id to submission.attachments)
        lastSubmittedKey = "post.$id"
        sendError = null
        fun drop() {
            sending = sending.filter { it.id != id }
            sendingAttachments = sendingAttachments - id
        }
        scope.launch {
            try {
                val upload = if (submission.attachments.isEmpty()) null else transport.upload(submission.attachments)
                // The account, workspace, consent or chat may have changed while files uploaded.
                currentCoroutineContext().ensureActive()
                if (!allowed() || readOnly) { drop(); return@launch }
                transport.post(text, id, upload)
                retry = null
                if (allowed()) refresh(force = true)
            } catch (e: CancellationException) {
                // Left, or the scope ended: never posted later, never put back into another composer.
                drop()
                throw e
            } catch (e: Exception) {
                drop()
                if (!allowed()) return@launch
                sendError = postFailureMessage(e)
                unsent = submission
            }
        }
        return true
    }

    /** The probe, then the full read when the chat changed; `force` skips the probe. False if it could not read. */
    suspend fun refresh(force: Boolean = false): Boolean {
        try {
            if (!force && loaded) {
                val probe = transport.detail(1)
                // The server bumps a post's activity after appending it, so the probe can see
                // new activity under a stamp that has not changed.
                noteActivity(probe)
                if (stamp(probe) == revision) return true
            }
            coroutineScope {
                val detail = async { transport.detail(TAIL) }
                val listed = async { transport.agents() }
                val read = detail.await()
                apply(read, listed.await())
            }
            return true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (!loaded) { loadError = "Couldn't load this chat."; loaded = true }
            return false
        } finally {
            reads++
        }
    }

    /**
     * While the chat is open it is read up to its newest activity. A marker that failed is sent
     * again when this next runs; one that succeeded is not repeated.
     */
    suspend fun readUpToNewest(mark: suspend (Long) -> Unit) {
        val seq = activitySeq ?: return
        if ((markedSeq ?: -1) >= seq) return
        try {
            mark(seq)
            markedSeq = maxOf(markedSeq ?: seq, seq)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Still unread; the next poll tries again.
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

    private fun noteActivity(detail: AgentConversationDetail) {
        val seq = detail.activitySeq?.numberValue?.toLong() ?: return
        activitySeq = maxOf(activitySeq ?: seq, seq)
    }

    private fun stamp(detail: AgentConversationDetail) = "${detail.transcriptUpdatedAt.orEmpty()}:${detail.messageCount ?: detail.messages.size}"

    private fun apply(detail: AgentConversationDetail, listed: List<ChannelAgent>) {
        stored = detail.messages.mapNotNull(ChannelPost::from)
        sending = ChannelPost.stillSending(stored, sending)
        sendingAttachments = sendingAttachments.filterKeys { id -> sending.any { it.id == id } }
        events = detail.timelineEvents
        agents = listed
        readOnly = detail.readOnly == true
        detail.title?.takeIf { it.isNotBlank() }?.let { title = it }
        faces = detail.faces
        noteActivity(detail)
        revision = stamp(detail)
        loadError = null
        loaded = true
    }

    companion object {
        /** The server's own reason, as iOS shows it; never a raw page or payload. */
        internal fun postFailureMessage(e: Exception): String {
            val message = when (e) {
                is NuphosApi.Failure.Http, is AgentChatApi.Conflict -> e.message
                else -> null
            }?.trim()
            return message?.takeIf { it.isNotEmpty() && it.length <= 300 && it.first() !in "<{[" }
                ?: "Check your connection and try again."
        }
        const val TAIL = 200
        const val POLL_MS = 4_000L
    }
}
