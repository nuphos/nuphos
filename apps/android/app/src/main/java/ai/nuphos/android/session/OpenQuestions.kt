package ai.nuphos.android.session

import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
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
class OpenQuestions(private val source: Source) {
    interface Source {
        /** Every page of the viewer's conversations with an open question, with their parents. */
        suspend fun pending(): List<AgentConversation> = emptyList()
        /** The owner's reply to [sessionId], naming the question it answers. */
        suspend fun answer(sessionId: String, text: String, requestId: String) {}
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
    }

    private var listed by mutableStateOf<List<BotQuestion>>(emptyList())
    /** Answered here; hidden until the listing no longer has them open. */
    private var answered by mutableStateOf(emptySet<String>())
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
     * The owner's own reply to the conversation that asked, naming the question, so it resolves
     * that one request wherever it is shown. Hidden at once; shown again if it could not be sent.
     */
    fun answer(question: BotQuestion, text: String, scope: CoroutineScope, onError: (Exception) -> Unit) {
        answered = answered + question.id
        scope.launch {
            try {
                source.answer(question.sessionId, text, question.request.id)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                answered = answered - question.id
                onError(e)
            }
        }
    }
}
