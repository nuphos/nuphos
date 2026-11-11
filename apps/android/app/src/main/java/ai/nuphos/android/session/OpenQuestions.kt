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
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Open questions read from the pending listing, as Desktop's Inbox reads them, and answered from
 * their cards. The Inbox shows them all; a Bot's chat only those under the Bot.
 */
class OpenQuestions(
    private val source: Source,
    /** A Bot's own chat, if it has one: a Bot's own question is answered there, where it shows. */
    private val chatOf: (botId: String) -> String? = { null },
) {
    interface Source {
        /** Every page of the viewer's conversations with an open question, with their parents. */
        suspend fun pending(): List<AgentConversation> = emptyList()
        /** The owner's reply to [sessionId], naming the question it answers. */
        suspend fun answer(sessionId: String, text: String, requestId: String) {}
        /** A post in the Bot's chat [chatId], naming its question it answers. */
        suspend fun answerInChat(chatId: String, text: String, requestId: String) {}
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

        override suspend fun answer(sessionId: String, text: String, requestId: String) {
            val sent = withContext(Dispatchers.IO) {
                AgentChatApi.reply(token, teamId, sessionId, text, decisionReplyTo = requestId)
            }
            if (!sent) throw NuphosApi.Failure.InvalidResponse
        }

        override suspend fun credentials(sessionId: String): JsonValue? =
            NuphosApi.conversationDetail(token, teamId, sessionId, tail = 1).credentialAccess

        override suspend fun saveCredentials(sessionId: String, access: JsonValue) =
            AgentChatApi.updateCredentials(token, teamId, sessionId, access)

        override suspend fun answerInChat(chatId: String, text: String, requestId: String) {
            ChannelSession.Api(token, teamId, chatId)
                .post(text, java.util.UUID.randomUUID().toString().lowercase(), null, null, decisionReplyTo = requestId)
        }
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

    /** What the cards show: the listing, less what was answered here. */
    val list: List<BotQuestion> get() = listed.filter { it.id !in answered }

    suspend fun refresh(pick: (List<AgentConversation>) -> List<BotQuestion> = BotQuestions::open) {
        try {
            listed = pick(source.pending())
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
     * the question once it covers a provider asked for; the card leaves with the listing.
     */
    suspend fun select(selection: CredentialSelection, question: BotQuestion) {
        failures = failures - question.id
        try {
            source.saveCredentials(question.sessionId, selection.json)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failures = failures + (question.id to ChannelSession.postFailureMessage(e))
        }
        refresh()
    }

    /**
     * The owner's own reply to the conversation that asked, naming the question, so it resolves
     * that one request wherever it is shown: a card's quick reply. Hidden at once; if it could not
     * be sent, the card comes back with why. [send] is how the answer goes out.
     */
    fun answer(question: BotQuestion, text: String, scope: CoroutineScope,
               send: suspend () -> Unit = {
                   val chat = chatOf(question.sessionId)
                   if (chat != null) source.answerInChat(chat, text, question.request.id)
                   else source.answer(question.sessionId, text, question.request.id)
               }) {
        answered = answered + question.id
        failures = failures - question.id
        scope.launch {
            try {
                send()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                answered = answered - question.id
                failures = failures + (question.id to ChannelSession.postFailureMessage(e))
            }
        }
    }
}
