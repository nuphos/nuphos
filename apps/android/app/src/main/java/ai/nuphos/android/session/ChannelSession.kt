package ai.nuphos.android.session

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.data.TransferDownloadGroup
import ai.nuphos.android.model.AgentConversationDetail
import ai.nuphos.android.model.BotFaces
import ai.nuphos.android.model.ChannelAgent
import ai.nuphos.android.model.ChatFace
import ai.nuphos.android.model.ChannelPost
import ai.nuphos.android.model.ChannelReply
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
import ai.nuphos.android.data.SseClient
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.channels.Channel
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
    interface Transport : OpenQuestions.Source {
        suspend fun detail(tail: Int): AgentConversationDetail
        suspend fun agents(): List<ChannelAgent>
        suspend fun attachment(groupId: String): TransferDownloadGroup
        /** Uploads a post's files to the transfer store and returns their group. */
        suspend fun upload(attachments: List<ComposerAttachment>): String
        /** [upload], telling [onProgress] how far the files have gone. */
        suspend fun upload(attachments: List<ComposerAttachment>, onProgress: (AttachmentTransfers.Progress) -> Unit): String = upload(attachments)
        /** `POST …/channel-messages` with `{text, id, upload, replyTo}`; a repeated id is not posted twice. */
        suspend fun post(text: String, id: String, upload: String?, replyTo: String?)
        /** Retry after an agent could not reply: it reads again what it has not read yet. */
        suspend fun wake(agentId: String) {}
        /**
         * Follows which of the team's conversations change (#3906) until the stream ends or fails:
         * [opened] once it is up, [changed] with each changed session. False when the backend has
         * no such stream, so the chat keeps polling.
         */
        suspend fun changes(opened: () -> Unit, changed: (String) -> Unit): Boolean = false
    }

    class Api(private val token: String, private val teamId: String, private val channelId: String) : Transport {
        override suspend fun detail(tail: Int) = NuphosApi.conversationDetail(token, teamId, channelId, tail, runtimeState = false)
        override suspend fun agents() = NuphosApi.channelAgents(token, teamId, channelId)
        override suspend fun attachment(groupId: String) = NuphosApi.channelAttachment(token, teamId, channelId, groupId)
        private val transfers = AttachmentTransfers()
        override suspend fun upload(attachments: List<ComposerAttachment>) = upload(attachments) {}
        override suspend fun upload(attachments: List<ComposerAttachment>, onProgress: (AttachmentTransfers.Progress) -> Unit): String {
            val pending = transfers.retain(attachments)
            return transfers.prepare(token, teamId, pending, allowed = { AiAccess.bind(token)() }, onProgress = onProgress).groupId
        }
        override suspend fun post(text: String, id: String, upload: String?, replyTo: String?) {
            val body = buildList {
                add("text" to JsonValue.Str(text)); add("id" to JsonValue.Str(id))
                if (upload != null) add("upload" to JsonValue.Str(upload))
                if (replyTo != null) add("replyTo" to JsonValue.Str(replyTo))
            }
            AgentChatApi.send("POST", "agent/conversations/${android.net.Uri.encode(channelId)}/channel-messages", token,
                query = listOf("teamId" to teamId), body = JsonValue.obj(*body.toTypedArray()))
        }
        override suspend fun wake(agentId: String) {
            AgentChatApi.send("POST", "agent/conversations/${android.net.Uri.encode(channelId)}/agents/${android.net.Uri.encode(agentId)}/wake",
                token, query = listOf("teamId" to teamId))
        }
        override suspend fun changes(opened: () -> Unit, changed: (String) -> Unit): Boolean {
            val request = okhttp3.Request.Builder()
                .url("${NuphosApi.baseUrl(token)}/teams/${android.net.Uri.encode(teamId)}/agent-changes")
                .header("Authorization", "Bearer $token")
                .header("Accept", "text/event-stream")
                .header("Accept-Encoding", "identity")
                .header("x-atlas-client", ai.nuphos.android.data.Http.clientHeader())
                .build()
            try {
                // Nothing comes until the first change or 5 s heartbeat; three missed is a dead stream.
                SseClient.events(request, firstByteTimeoutMs = 15_000, idleTimeoutMs = 15_000, onOpen = opened).collect { event ->
                    JsonValue.parse(event.data)?.get("sessionId")?.stringValue?.let(changed)
                }
            } catch (e: SseClient.Failure.BadStatus) {
                if (e.code == 404) return false
                throw e
            }
            return true
        }
        private val questions = OpenQuestions.Api(token, teamId)
        override suspend fun pending() = questions.pending()
        override suspend fun answer(sessionId: String, requestId: String, answer: JsonValue) =
            questions.answer(sessionId, requestId, answer)
        override suspend fun dismiss(sessionId: String, requestId: String, reason: String?) =
            questions.dismiss(sessionId, requestId, reason)
        override suspend fun credentials(sessionId: String) = questions.credentials(sessionId)
        override suspend fun saveCredentials(sessionId: String, access: JsonValue) = questions.saveCredentials(sessionId, access)
    }

    var title by mutableStateOf(title)
        private set
    /** The chat's icon: the members other than the viewer that it shows. */
    var faces by mutableStateOf<List<ChatFace>>(emptyList())
    /** The Bot this is the 1:1 chat of; null in a group chat, even one with only a Bot in it. */
    var botId by mutableStateOf<String?>(null)
    /** When the chat was made, as its last read says; null until then. */
    var createdAt by mutableStateOf<java.time.Instant?>(null)
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
    /** Bumped after every read of the chat, so a failed read marker retries with the next poll. */
    var reads by mutableStateOf(0L)
        private set
    private var markedSeq: Long? = null
        private set
    private var revision: List<Any?>? = null

    /** Posts shown at once, until the chat returns them under the same id. */
    var sending by mutableStateOf<List<ChannelPost>>(emptyList())
        private set
    /** What a sending post attached, drawn from the device until it is posted. */
    var sendingAttachments by mutableStateOf<Map<String, List<ComposerAttachment>>>(emptyMap())
        private set
    /**
     * How far a sending post's files have uploaded, shown under it as in a Task's chat. Once they
     * are all out it holds [AttachmentTransfers.Progress.filesSent] until the chat returns the post.
     */
    var sendingProgress by mutableStateOf<Map<String, AttachmentTransfers.Progress>>(emptyMap())
        private set
    /** A post that could not be sent goes back into the composer. */
    var unsent by mutableStateOf<ComposerSubmission?>(null)
    /** The post the next one answers, quoted above the composer. */
    var replying by mutableStateOf<ChannelReply?>(null)
    /** Bumped by each Reply, so choosing the same post again still raises the keyboard. */
    var replyRequests by mutableStateOf(0)
        private set

    fun reply(to: ChannelPost) {
        replying = to.asReply()
        replyRequests++
    }

    var sendError by mutableStateOf<String?>(null)
    /** The latest send, so the transcript returns to the end for it. */
    var lastSubmittedKey by mutableStateOf<String?>(null)
        private set
    /** A resend of the same post reuses its id, so a post that did land is not doubled. */
    private var retry: Pair<String, String>? = null

    val posts: List<ChannelPost> get() = stored + ChannelPost.stillSending(stored, sending)

    /** In a Bot's chat: its open questions, answered and connected on their cards as in the Inbox. */
    val open = OpenQuestions(transport)
    /** In a Bot's chat: the open questions of the Bot and of every agent under it. */
    val questions: List<BotQuestion> get() = open.list

    /** A Bot's chat reads the pending listing, as Desktop's does; any other chat has none. */
    suspend fun refreshQuestions() {
        val bot = botId ?: return
        open.refresh { BotQuestions.under(bot, it) }
    }

    /** Answers a question in this chat: the server wakes the agent that asked, which replies where it asked. */
    fun answer(question: BotQuestion, text: String, scope: kotlinx.coroutines.CoroutineScope) =
        open.answer(question, text, scope)

    /** Answers a several-question or multi-select card with what its form built. */
    fun answer(question: BotQuestion, body: ai.nuphos.android.data.JsonValue, scope: kotlinx.coroutines.CoroutineScope) =
        open.answer(question, body, scope)

    /** Dismisses a question in this chat at once, without a reason: the agent that asked is told. */
    fun dismiss(question: BotQuestion, scope: kotlinx.coroutines.CoroutineScope) = open.dismiss(question, null, scope)

    fun retry(agentId: String, scope: kotlinx.coroutines.CoroutineScope) {
        scope.launch {
            try { transport.wake(agentId); refresh(force = true) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { sendError = postFailureMessage(e) }
        }
    }

    /** Why the last answer to [question] failed, shown on its card. */
    fun answerFailure(question: BotQuestion): String? = open.failures[question.id]

    /** Shown at once; files upload first, then the post goes out with their group. */
    fun send(submission: ComposerSubmission, viewerId: String?, viewerName: String?, viewerAvatar: String?,
             scope: kotlinx.coroutines.CoroutineScope, allowed: () -> Boolean = { true },
             newId: () -> String = { java.util.UUID.randomUUID().toString().lowercase() }): Boolean {
        val text = submission.text.trim()
        if (readOnly || !allowed() || (text.isEmpty() && submission.attachments.isEmpty())) return false
        // The same post is the same words and the same attached files (their own ids, not their
        // names): a post put back after a failure keeps its id, while a newly picked file never does.
        val reply = replying
        val key = (listOf(reply?.id.orEmpty(), text) + submission.attachments.map { it.id }).joinToString("\n")
        val id = retry?.takeIf { it.first == key }?.second ?: newId()
        retry = key to id
        sending = sending.filter { it.id != id } + ChannelPost(id, viewerId.orEmpty(), isAgent = false, name = viewerName ?: "You",
            avatarURL = viewerAvatar, text = text, sentAt = java.time.Instant.now(), sending = true, replyTo = reply)
        replying = null
        if (submission.attachments.isNotEmpty()) sendingAttachments = sendingAttachments + (id to submission.attachments)
        lastSubmittedKey = "post.$id"
        sendError = null
        fun drop() {
            sending = sending.filter { it.id != id }
            sendingAttachments = sendingAttachments - id
            sendingProgress = sendingProgress - id
        }
        scope.launch {
            try {
                val upload = if (submission.attachments.isEmpty()) null else transport.upload(submission.attachments) { progress ->
                    // A post already dropped keeps no progress behind.
                    if (sending.any { it.id == id }) sendingProgress = sendingProgress + (id to progress)
                }
                // The files are up; the post itself is on its way, and reads as sending until the chat has it.
                if (upload != null && sending.any { it.id == id }) sendingProgress = sendingProgress +
                    (id to AttachmentTransfers.Progress(AttachmentTransfers.Stage.Ready, filesSent = true))
                // The account, workspace, consent or chat may have changed while files uploaded.
                currentCoroutineContext().ensureActive()
                if (!allowed() || readOnly) { drop(); return@launch }
                transport.post(text, id, upload, reply?.id)
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
                replying = reply
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

    /**
     * True from leaving the screen until this poll's first good read on return. Only that read
     * counts: one that failed brought nothing, and another caller's may predate what arrived.
     */
    var returning by mutableStateOf(false)
        private set

    /** Why the open chat is read again: the poll's tick, a pushed change, or the change stream coming up or going down. */
    private enum class Wake { TICK, CHANGED, UP, DOWN }

    /** A pushed change waits to be read: more changes before that read need no read of their own. */
    private val changePending = AtomicBoolean(false)

    /**
     * Until cancelled, while the chat is on screen. The server pushes which conversations changed
     * (#3906), so the chat is read the moment it does, and when that stream comes up (it may have
     * missed some); it polls only while the stream is down. Its questions are polled either way.
     */
    suspend fun poll() {
        try {
            coroutineScope {
                val wakes = Channel<Wake>(Channel.UNLIMITED)
                launch { while (true) { wakes.send(Wake.TICK); delay(POLL_MS) } }
                launch { followChanges(wakes) }
                var pushed = false
                // One read at a time, so an older read never lands over a newer one.
                for (wake in wakes) when (wake) {
                    Wake.UP -> { pushed = true; if (refresh(force = true)) returning = false }
                    Wake.DOWN -> pushed = false
                    Wake.CHANGED -> { changePending.set(false); if (refresh(force = true)) returning = false }
                    Wake.TICK -> { if (!pushed && refresh(force = !loaded)) returning = false; refreshQuestions() }
                }
            }
        } finally {
            returning = true
        }
    }

    /** Follows the team's changes, waking the chat for its own, and reconnects with backoff. */
    private suspend fun followChanges(wakes: Channel<Wake>) {
        var failures = 0
        while (true) {
            val started = System.nanoTime()
            val pushes = try {
                transport.changes(opened = { wakes.trySend(Wake.UP) }) { sessionId ->
                    if (sessionId == channelId && changePending.compareAndSet(false, true)) wakes.trySend(Wake.CHANGED)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                true
            }
            // A backend from before the push: the chat keeps polling.
            if (!pushes) return
            wakes.send(Wake.DOWN)
            failures = if (System.nanoTime() - started > 30_000_000_000L) 1 else failures + 1
            delay(minOf(30_000L, 500L shl minOf(failures, 6)))
        }
    }

    /** A posted file group, read when its card shows; a failed read is never cached, so the card can retry. */
    suspend fun transferGroup(groupId: String): TransferDownloadGroup = transport.attachment(groupId)

    private fun noteActivity(detail: AgentConversationDetail) {
        val seq = detail.activitySeq?.numberValue?.toLong() ?: return
        activitySeq = maxOf(activitySeq ?: seq, seq)
    }

    /**
     * What an open chat shows, as its probe reports it: a change means a full read. Its name and faces
     * count too: an untitled Bot chat is named after the Bot, so renaming the Bot changes them without a post.
     */
    private fun stamp(detail: AgentConversationDetail): List<Any?> =
        listOf(detail.transcriptUpdatedAt, detail.messageCount ?: detail.messages.size, detail.title, detail.faces)

    private fun apply(detail: AgentConversationDetail, listed: List<ChannelAgent>) {
        stored = detail.messages.mapNotNull(ChannelPost::from)
        sending = ChannelPost.stillSending(stored, sending)
        sendingAttachments = sendingAttachments.filterKeys { id -> sending.any { it.id == id } }
        sendingProgress = sendingProgress.filterKeys { id -> sending.any { it.id == id } }
        events = detail.timelineEvents
        agents = listed
        // A teammate's Bot is in none of this viewer's lists: its face comes from the chat.
        listed.forEach { BotFaces.learn(it.sessionId, it.avatar, it.avatarBackground) }
        readOnly = detail.readOnly == true
        detail.title?.takeIf { it.isNotBlank() }?.let { title = it }
        faces = detail.faces
        botId = detail.botId
        createdAt = detail.createdAt
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
