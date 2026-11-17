package ai.nuphos.android.session

import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.JsonValue
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.CredentialSelection
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Open questions read from the pending listing, as Desktop's Inbox reads them, and answered from
 * their cards. The Inbox shows them all, less those snoozed; a Bot's chat only those under the Bot.
 */
class OpenQuestions(private val source: Source, private val clock: () -> Instant = Instant::now) {
    interface Source {
        /** Every page of the viewer's conversations with an open question, with their parents. */
        suspend fun pending(): List<AgentConversation> = emptyList()
        /** Answers [requestId] of [sessionId]: the server wakes the agent that asked; no message is sent. */
        suspend fun answer(sessionId: String, requestId: String, answer: JsonValue) {}
        /** Closes [requestId] unanswered: the server tells the agent that asked who dismissed it, and [reason]. */
        suspend fun dismiss(sessionId: String, requestId: String, reason: String?) {}
        /** Sets [requestId] aside in its owner's Inbox until [until], or brings it back with null; the agent is not told. */
        suspend fun snooze(sessionId: String, requestId: String, until: Instant?) {}
        /** [sessionId]'s stored credential selection. */
        suspend fun credentials(sessionId: String): JsonValue? = null
        /** Saves [sessionId]'s credential selection, as its picker would. */
        suspend fun saveCredentials(sessionId: String, access: JsonValue) {}
    }

    class Api(private val token: String, private val teamId: String) : Source {
        override suspend fun pending(): List<AgentConversation> {
            val rows = mutableListOf<AgentConversation>()
            var cursor: String? = null
            // Bounded like Desktop's: a cursor never repeats a page.
            repeat(10) {
                val page = NuphosApi.conversations(token, teamId, cursor = cursor, limit = 100, pendingDecision = true)
                rows += page.rows
                val next = page.nextCursor
                if (!page.hasMore || next == null || next == cursor) return rows
                cursor = next
            }
            return rows
        }

        override suspend fun answer(sessionId: String, requestId: String, answer: JsonValue) {
            AgentChatApi.send("POST",
                "agent/conversations/${android.net.Uri.encode(sessionId)}/decisions/${android.net.Uri.encode(requestId)}/answer",
                token, query = listOf("teamId" to teamId), body = answer)
        }

        override suspend fun dismiss(sessionId: String, requestId: String, reason: String?) =
            AgentChatApi.dismissDecision(token, teamId, sessionId, requestId, reason)

        override suspend fun snooze(sessionId: String, requestId: String, until: Instant?) =
            AgentChatApi.snoozeDecision(token, teamId, sessionId, requestId, until)

        override suspend fun credentials(sessionId: String): JsonValue? =
            NuphosApi.conversationDetail(token, teamId, sessionId, tail = 1).credentialAccess

        override suspend fun saveCredentials(sessionId: String, access: JsonValue) =
            AgentChatApi.updateCredentials(token, teamId, sessionId, access)
    }

    private var listed by mutableStateOf<List<BotQuestion>>(emptyList())
    /** Answered here; hidden until the listing no longer has them open. */
    private var answered by mutableStateOf(emptySet<String>())
    /** Why the last answer to a question failed, by [BotQuestion.id], until it is answered again. */
    var failures by mutableStateOf(emptyMap<String, String>())
        private set
    /** False until the first listing lands. */
    var loaded by mutableStateOf(false)
        private set

    /** When the listing was last read: a snoozed question comes back with the first read after its time. */
    private var now by mutableStateOf(clock())

    /** What the cards show: the listing, less what was answered or dismissed here. */
    val list: List<BotQuestion> get() = listed.filter { it.id !in answered }

    /** The Inbox's list, and its badge: [list] less what its owner snoozed until a time still to come. */
    val waiting: List<BotQuestion> get() = list.filter { !it.snoozed(now) }

    /** The Inbox's Snoozed section: what [waiting] leaves out until its time. */
    val snoozed: List<BotQuestion> get() = list.filter { it.snoozed(now) }

    private fun BotQuestion.snoozed(now: Instant) =
        request.snoozedUntil?.let { runCatching { Instant.parse(it) }.getOrNull() }?.isAfter(now) == true

    /** A dismissal waiting out its Undo window, its question already hidden. */
    var held by mutableStateOf<BotQuestion?>(null)
        private set
    private var holding: Pair<BotQuestion, Job>? = null
    private val undone = mutableSetOf<String>()

    /** Which of the listing's questions this list shows: all of them, or a Bot's; kept for refreshes after a save. */
    private var pick: (List<AgentConversation>) -> List<BotQuestion> = BotQuestions::open

    suspend fun refresh(pick: (List<AgentConversation>) -> List<BotQuestion> = this.pick) {
        this.pick = pick
        try {
            listed = pick(source.pending())
            now = clock()
            answered = answered intersect listed.map { it.id }.toSet()
            loaded = true
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Kept as they were; the next poll tries again.
        }
    }

    /**
     * The asking conversation's credential selection, for an integration card to add to; null, with
     * why on its card, if it could not be read.
     */
    suspend fun storedSelection(question: BotQuestion): CredentialSelection? {
        failures = failures - question.id
        return try {
            CredentialSelection(source.credentials(question.sessionId) ?: JsonValue.Obj(emptyMap()))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failures = failures + (question.id to ChannelSession.postFailureMessage(e))
            null
        }
    }

    /**
     * Answers a question naming the member's own credentials: adds them to the asking conversation's stored
     * selection, nothing else. [connected] is the member's own, null when they could not be read; either way
     * short of all of them is said on the card.
     */
    suspend fun useOwn(ids: List<String>, question: BotQuestion, connected: Set<String>?) {
        if (connected == null) {
            failures = failures + (question.id to "Couldn't load your credentials. Try again.")
            return
        }
        if (!connected.containsAll(ids)) {
            failures = failures + (question.id to "Connect it in Settings → Personal Credentials first.")
            return
        }
        val stored = storedSelection(question) ?: return
        val own = stored.ids["personalCredentialIds"].orEmpty() + ids
        select(stored.copy(ids = stored.ids + ("personalCredentialIds" to own)), question)
    }

    /**
     * Saves the asking conversation's selection, as its credential picker would. The server answers
     * the question once it adds a provider asked for; the card leaves with the listing, or says why it is still open.
     */
    suspend fun select(selection: CredentialSelection, question: BotQuestion) {
        failures = failures - question.id
        try {
            source.saveCredentials(question.sessionId, selection.json)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failures = failures + (question.id to ChannelSession.postFailureMessage(e))
            return
        }
        refresh()
        if (listed.any { it.id == question.id }) {
            failures = failures + (question.id to "The selection adds no credential this question asks for.")
        }
    }

    /**
     * Answers a question from its card: one of its options, or "Done." for a to-do. The server
     * wakes the agent that asked, which replies where it asked; no message is sent. Hidden at once;
     * if the answer is refused, the card comes back with why.
     */
    fun answer(question: BotQuestion, text: String, scope: CoroutineScope) =
        answer(question, if (question.request.options.orEmpty().contains(text))
            JsonValue.obj("choices" to JsonValue.Arr(listOf(JsonValue.Str(text))))
        else JsonValue.obj("text" to JsonValue.Str(text)), scope)

    /** Answers a question with [body] as its form builds it: one question's choices or text, or one per question. */
    fun answer(question: BotQuestion, body: JsonValue, scope: CoroutineScope) {
        answered = answered + question.id
        failures = failures - question.id
        scope.launch {
            try {
                source.answer(question.sessionId, question.request.id, body)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                answered = answered - question.id
                failures = failures + (question.id to ChannelSession.postFailureMessage(e))
            }
        }
    }

    /**
     * Snoozes a question out of the Inbox until [until], or brings it back with null. It moves at
     * once and stays open where it was asked; if the server refuses, it moves back with why.
     */
    fun snooze(question: BotQuestion, until: Instant?, scope: CoroutineScope) {
        val before = question.request.snoozedUntil
        snoozedHere(question.id, until?.toString())
        failures = failures - question.id
        scope.launch {
            try {
                source.snooze(question.sessionId, question.request.id, until)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                snoozedHere(question.id, before)
                failures = failures + (question.id to ChannelSession.postFailureMessage(e))
            }
        }
    }

    private fun snoozedHere(id: String, until: String?) {
        listed = listed.map { if (it.id == id) it.copy(request = it.request.copy(snoozedUntil = until)) else it }
    }

    /**
     * Dismisses a question: hidden at once, and after [holdMs], the Inbox's Undo window, closed with
     * [reason] for the agent that asked. A newer dismissal, or leaving, sends the one held at once.
     * If the server refuses, the card comes back with why.
     */
    fun dismiss(question: BotQuestion, reason: String?, scope: CoroutineScope, holdMs: Long = 0) {
        holding?.second?.cancel()
        answered = answered + question.id
        failures = failures - question.id
        undone -= question.id
        val job = scope.launch {
            try {
                delay(holdMs)
            } finally {
                if (holding?.first == question) { holding = null; held = null }
                if (!undone.remove(question.id)) withContext(NonCancellable) { sendDismissal(question, reason) }
            }
        }
        if (holdMs > 0) { holding = question to job; held = question }
    }

    /** Takes back the dismissal still held: its question is back, and nothing is sent. */
    fun undo() {
        val (question, job) = holding ?: return
        holding = null
        held = null
        undone += question.id
        answered = answered - question.id
        job.cancel()
    }

    private suspend fun sendDismissal(question: BotQuestion, reason: String?) {
        try {
            source.dismiss(question.sessionId, question.request.id, reason?.trim()?.takeIf { it.isNotEmpty() })
        } catch (e: Exception) {
            answered = answered - question.id
            failures = failures + (question.id to ChannelSession.postFailureMessage(e))
        }
    }

    companion object {
        /** How long an Inbox dismissal waits, its question already gone, before it is sent. */
        const val UNDO_MS = 5_000L
    }
}
