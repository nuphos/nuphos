package ai.nuphos.android.session

import androidx.compose.runtime.mutableStateMapOf
import ai.nuphos.android.data.AgentChatApi
import ai.nuphos.android.data.NuphosApi
import ai.nuphos.android.model.AgentConversation
import ai.nuphos.android.model.AgentConversationsPage

/**
 * Archive Bot, as on Desktop: the Bot and the viewer's own 1:1 chats with it go together.
 *
 * Several requests can't be one change. So the chats are found first, every page of them,
 * and nothing is written unless that search finished. Then the chats are archived one at a
 * time and the Bot last. When one of those fails, what this attempt archived is restored.
 * Whatever is left is reported as archived, not archived, or unknown, and never as done.
 *
 * [allowed] is checked before every request: once access, the session or the workspace has
 * changed, no further request is sent, restoring included.
 */
class BotArchive(
    private val listChats: suspend (cursor: String?) -> AgentConversationsPage,
    private val setArchived: suspend (sessionId: String, archived: Boolean) -> Unit,
    private val allowed: () -> Boolean,
) {
    enum class State { Archived, NotArchived, Unknown }

    sealed class Result {
        data object Archived : Result()
        /** Nothing was changed. A null reason means the action was dropped with nothing to say. */
        data class NotChanged(val reason: String?) : Result()
        /** Some of it is archived, or may be. [chats] holds only the chats this attempt touched. */
        data class Partial(val chats: Map<String, State>, val bot: State, val reason: String) : Result()
    }

    private sealed class Write {
        data object Done : Write()
        /** The server answered no. [stop]: access is gone, so nothing more is sent. */
        data class Refused(val stop: Boolean) : Write()
        /** Sent, but no answer says whether it happened. */
        data object Unknown : Write()
    }

    private suspend fun write(sessionId: String, archived: Boolean): Write = try {
        setArchived(sessionId, archived)
        Write.Done
    } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
    } catch (_: NuphosApi.Failure.Unauthorized) {
        Write.Refused(stop = true)
    } catch (e: NuphosApi.Failure.Http) {
        Write.Refused(stop = e.code == 403)
    } catch (e: AgentChatApi.Conflict) {
        // The server answered with an error, so the change didn't happen.
        Write.Refused(stop = (e as? AgentChatApi.Conflict.Other)?.status == 403)
    } catch (_: Exception) {
        Write.Unknown
    }

    sealed class Search {
        data class Found(val chats: List<AgentConversation>) : Search()
        data class Failed(val reason: String?) : Search()
    }

    /** Every chat of the viewer's with [botId], archived ones too. Fails rather than guess. */
    suspend fun search(botId: String): Search {
        val found = mutableListOf<AgentConversation>()
        val cursors = mutableSetOf<String>()
        var cursor: String? = null
        repeat(MAX_PAGES) {
            if (!allowed()) return Search.Failed(null)
            val page = try { listChats(cursor) } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                catch (_: Exception) { return Search.Failed(SEARCH_FAILED) }
            if (!allowed()) return Search.Failed(null)
            found += page.conversations.filter { it.isChannel && it.botId == botId }
            if (!page.hasMore) return Search.Found(found.distinctBy { it.sessionId })
            // A next page with no new place to read it from: the list can't be read to the end.
            val next = page.nextCursor?.takeIf { it.isNotEmpty() && cursors.add(it) } ?: return Search.Failed(SEARCH_INCOMPLETE)
            cursor = next
        }
        return Search.Failed(SEARCH_INCOMPLETE)
    }

    suspend fun run(botId: String): Result {
        val chats = when (val search = search(botId)) {
            is Search.Failed -> return Result.NotChanged(search.reason)
            is Search.Found -> search.chats.filter { !it.isArchived }.map { it.sessionId }
        }
        val touched = linkedMapOf<String, State>()
        for (chat in chats) {
            if (!allowed()) return stopped(touched, State.NotArchived, null)
            when (val outcome = write(chat, true)) {
                Write.Done -> touched[chat] = State.Archived
                is Write.Refused -> {
                    if (outcome.stop) return stopped(touched, State.NotArchived, NO_ACCESS)
                    return restore(touched, botState = State.NotArchived, botTouched = false)
                }
                Write.Unknown -> {
                    touched[chat] = State.Unknown
                    return restore(touched, botState = State.NotArchived, botTouched = false)
                }
            }
        }
        if (!allowed()) return stopped(touched, State.NotArchived, null)
        return when (val outcome = write(botId, true)) {
            Write.Done -> Result.Archived
            is Write.Refused -> if (outcome.stop) stopped(touched, State.NotArchived, NO_ACCESS)
                else restore(touched, botState = State.NotArchived, botTouched = false, botId = botId)
            // Restoring the Bot too settles it either way, since archiving it again is harmless.
            Write.Unknown -> restore(touched, botState = State.Unknown, botTouched = true, botId = botId)
        }
    }

    /**
     * Stops without sending more. With nothing written there is nothing to report unless the
     * server refused ([refusal]); otherwise what was written is reported, not undone.
     */
    private fun stopped(touched: Map<String, State>, bot: State, refusal: String?): Result =
        if (touched.isEmpty() && bot == State.NotArchived) Result.NotChanged(refusal) else Result.Partial(touched, bot, refusal ?: STOPPED)

    /** Undoes this attempt, the Bot first if it was touched, then the chats in reverse. */
    private suspend fun restore(touched: LinkedHashMap<String, State>, botState: State, botTouched: Boolean, botId: String? = null): Result {
        var bot = botState
        if (botTouched && botId != null) {
            if (!allowed()) return Result.Partial(touched, bot, STOPPED)
            when (val outcome = write(botId, false)) {
                Write.Done -> bot = State.NotArchived
                is Write.Refused -> return Result.Partial(touched, bot, if (outcome.stop) STOPPED else NOT_RESTORED)
                Write.Unknown -> return Result.Partial(touched, bot, NOT_RESTORED)
            }
        }
        for (chat in touched.keys.reversed()) {
            if (!allowed()) return Result.Partial(touched, bot, STOPPED)
            when (val outcome = write(chat, false)) {
                Write.Done -> touched[chat] = State.NotArchived
                is Write.Refused -> return Result.Partial(touched, bot, if (outcome.stop) STOPPED else NOT_RESTORED)
                Write.Unknown -> return Result.Partial(touched, bot, NOT_RESTORED)
            }
        }
        return Result.NotChanged(FAILED)
    }

    /** "Restore chats" after a partial result: reads where they are now, then unarchives those still archived. */
    suspend fun restoreChats(botId: String, chatIds: Set<String>): Result {
        val archived = when (val search = search(botId)) {
            is Search.Failed -> return Result.NotChanged(search.reason)
            is Search.Found -> search.chats.filter { it.sessionId in chatIds && it.isArchived }.map { it.sessionId }
        }
        val left = linkedMapOf<String, State>().apply { archived.forEach { put(it, State.Archived) } }
        for (chat in archived) {
            if (!allowed()) return Result.Partial(left, State.NotArchived, STOPPED)
            when (val outcome = write(chat, false)) {
                Write.Done -> left[chat] = State.NotArchived
                is Write.Refused -> return Result.Partial(left, State.NotArchived, if (outcome.stop) STOPPED else NOT_RESTORED)
                Write.Unknown -> { left[chat] = State.Unknown; return Result.Partial(left, State.NotArchived, NOT_RESTORED) }
            }
        }
        return Result.NotChanged(RESTORED)
    }

    companion object {
        const val MAX_PAGES = 50
        const val SEARCH_FAILED = "Couldn't check this Bot's chats, so nothing was archived. Try again."
        const val SEARCH_INCOMPLETE = "Couldn't read all of your chats, so nothing was archived. Try again later."
        const val FAILED = "Couldn't archive this Bot. Nothing was changed. Try again."
        const val STOPPED = "Archiving stopped because your access or workspace changed. Nothing more was sent."
        const val NO_ACCESS = "Nuphos refused the change for this account, so nothing more was sent."
        const val NOT_RESTORED = "Archiving failed, and what was already archived couldn't all be restored."
        const val RESTORED = "Your chats with this Bot are back."
    }
}

/** What Archive Bot left unfinished, per signed-in session, so it outlives a page or consent change but not the account. */
object BotArchiveIssues {
    /** Not a store's: one going away mid-archive must not drop what was already written. */
    val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main.immediate)
    data class Issue(val teamId: String, val botId: String, val botTitle: String, val result: BotArchive.Result) {
        val chats: Map<String, BotArchive.State> get() = (result as? BotArchive.Result.Partial)?.chats.orEmpty()
    }
    private val issues = mutableStateMapOf<String, Issue>()
    fun of(token: String): Issue? = issues[token]
    fun put(token: String, issue: Issue) { issues[token] = issue }
    fun clear(token: String) { issues.remove(token) }
    /** Signing out: no account sees another's. */
    fun clearAll() = issues.clear()
}
