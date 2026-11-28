package ai.nuphos.android.session

import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import ai.nuphos.android.R
import ai.nuphos.android.data.BotActions
import ai.nuphos.android.data.SessionAccess
import ai.nuphos.android.data.SessionSharingApi
import ai.nuphos.android.data.SharingTransport
import ai.nuphos.android.model.TeamMember
import kotlinx.coroutines.CancellationException

/**
 * A group chat's Bots and people (#5313): adding them, removing them and leaving. People come
 * through the chat's sharing, as a Task's Share sheet invites them. The server decides who may.
 */
class ChannelMembers(private val transport: Transport, private val viewerId: String?) {
    /** The chat's sharing routes, and its Bots'. */
    interface Transport : SharingTransport {
        suspend fun addBot(botId: String)
        suspend fun removeBot(botId: String)
    }

    /** The real routes; a Bot added or removed is read back into the open chat. */
    class Api(private val token: String, private val team: String, private val session: ChannelSession) :
        Transport, SharingTransport by SessionSharingApi(token, team, session.channelId) {
        override suspend fun addBot(botId: String) { BotActions.addBot(token, team, session.channelId, botId); session.refresh(force = true) }
        override suspend fun removeBot(botId: String) { BotActions.removeBot(token, team, session.channelId, botId); session.refresh(force = true) }
    }

    /** What failed, and what Retry does again. */
    data class Failure(@StringRes val message: Int, val retry: suspend () -> Unit)

    val sharing = SharingState(transport) { isOwner }
    val people: List<SessionAccess.Participant> get() = sharing.access?.participants.orEmpty()
    val isOwner get() = people.any { it.id == viewerId && it.isOwner }
    /** Who the chat passes to when its owner leaves: the next person after them, as the server picks. */
    val heir get() = if (isOwner) people.firstOrNull { !it.isOwner } else null
    /** Nobody else is in it, so leaving archives it. */
    val last get() = people.none { it.id != viewerId }
    var failure by mutableStateOf<Failure?>(null); private set
    var busy by mutableStateOf(false); private set
    var left by mutableStateOf(false); private set

    fun dismissFailure() { failure = null }

    /** The owner's teammates are read once their ownership is known. */
    suspend fun load() {
        sharing.load()
        if (isOwner && sharing.members == null) sharing.loadMembers()
        failure = if (sharing.access == null) Failure(R.string.chats_members_load_failed) { load() } else null
    }

    suspend fun addBot(botId: String): Unit = attempt(R.string.chats_members_add_bot_failed, { addBot(botId) }) { transport.addBot(botId); true }
    suspend fun removeBot(botId: String): Unit = attempt(R.string.chats_members_remove_failed, { removeBot(botId) }) { transport.removeBot(botId); true }
    suspend fun removePerson(person: SessionAccess.Participant): Unit =
        attempt(R.string.chats_members_remove_failed, { removePerson(person) }) { sharing.remove(person).also { sharing.clearError() } }

    /** An invite the server refuses until it also gives use of the computer asks first, as in Share. */
    suspend fun addPerson(member: TeamMember): Unit = attempt(R.string.chats_members_add_person_failed, { addPerson(member) }) {
        (sharing.invite(member) || sharing.needsComputer != null).also { sharing.clearError() }
    }
    suspend fun confirmComputer() {
        val asked = sharing.needsComputer ?: return
        attempt(R.string.chats_members_add_person_failed, { asked.member?.let { addPerson(it) } }) {
            sharing.confirmComputer().also { sharing.clearError() }
        }
    }

    suspend fun leave(): Unit = attempt(R.string.chats_members_leave_failed, { leave() }) {
        transport.remove(viewerId ?: return@attempt false)
        left = true
        true
    }

    private suspend fun attempt(@StringRes message: Int, retry: suspend () -> Unit, action: suspend () -> Boolean) {
        if (busy) return
        busy = true; failure = null
        val done = try { action() } catch (e: CancellationException) { throw e } catch (_: Exception) { false } finally { busy = false }
        if (!done) failure = Failure(message, retry)
    }
}
