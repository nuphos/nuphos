package ai.nuphos.android.session

import androidx.compose.runtime.*
import ai.nuphos.android.data.*
import ai.nuphos.android.model.TeamMember
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

/** Owner-only UI gate; server authorization remains authoritative. */
class SharingState(val transport: SharingTransport, private val owner: () -> Boolean) {
    val canManage get() = owner()
    var access by mutableStateOf<SessionAccess?>(null); private set
    var members by mutableStateOf<List<TeamMember>?>(null); private set
    var loadError by mutableStateOf<String?>(null); private set
    var membersError by mutableStateOf<String?>(null); private set
    var error by mutableStateOf<String?>(null); private set
    var pending by mutableStateOf<String?>(null); private set
    var added by mutableStateOf<TeamMember?>(null); private set
    /** An invite refused until it also gives this person use of the session's computer. */
    data class NeedsComputer(val id: String, val name: String, val member: TeamMember?)
    var needsComputer by mutableStateOf<NeedsComputer?>(null); private set
    var loading by mutableStateOf(false); private set
    val editable get() = canManage && access != null && pending == null && !loading
    val canInvite get() = editable
    fun clearError() { error = null }
    suspend fun load() {
        if (loading || pending != null) return
        loading = true
        try { coroutineScope {
            launch {
                loadError = null
                try { access = transport.read() } catch (e: Exception) { e.rethrowCancellation(); loadError = e.message ?: "Couldn't load sharing." }
            }
            if (canManage) {
                launch {
                    membersError = null
                    try { members = transport.members() } catch (e: Exception) { e.rethrowCancellation(); membersError = e.message ?: "Couldn't load teammates." }
                }

            }
        } } finally { loading = false }
    }
    suspend fun change(key: String, action: suspend () -> SessionAccess): Boolean {
        if (!editable) return false
        pending = key; error = null
        return try { access = action(); true }
        catch (e: Exception) { e.rethrowCancellation(); error = e.message ?: "Couldn't update sharing."; false }
        finally { pending = null }
    }
    suspend fun general(value: GeneralAccess) = change("access") { transport.general(value) }
    suspend fun remove(person: SessionAccess.Participant): Boolean {
        if (person.isOwner) return false
        return change(person.id) { transport.remove(person.id) }
    }
    suspend fun invite(member: TeamMember): Boolean {
        if (member.isRemoved || access?.participants?.any { it.id == member.id } == true) return false
        return send(NeedsComputer(member.id, member.displayName, member), grantComputerUse = false)
    }
    /** Inviting someone who reads only again offers them use of the session's computer. */
    suspend fun letReply(person: SessionAccess.Participant): Boolean {
        if (person.isOwner || person.canReply) return false
        return send(NeedsComputer(person.id, person.displayName, null), grantComputerUse = false)
    }
    /** The owner confirmed: the same invite, now also giving use of the computer. */
    suspend fun confirmComputer(): Boolean {
        val invite = needsComputer ?: return false
        needsComputer = null
        return send(invite, grantComputerUse = true)
    }
    fun cancelComputer() { needsComputer = null }
    /** A new member's invite leaves a receipt with Undo; letting a participant reply does not. */
    private suspend fun send(invite: NeedsComputer, grantComputerUse: Boolean): Boolean {
        if (!canInvite) return false
        pending = invite.id; error = null
        return try {
            access = transport.invite(invite.id, grantComputerUse)
            invite.member?.let { added = it }
            true
        } catch (e: Exception) {
            e.rethrowCancellation()
            if (!grantComputerUse && e.needsComputerUse) needsComputer = invite
            else error = e.message ?: "Couldn't update sharing."
            false
        } finally { pending = null }
    }
    suspend fun undo() {
        val member = added ?: return
        if (change(member.id) { transport.remove(member.id) }) added = null
    }
    /** The backend's answer while an invitee cannot use the session's computer yet. */
    private val Exception.needsComputerUse get() = this is AgentChatApi.Conflict.Other && code == "computer_use_required"
    private fun Exception.rethrowCancellation() { if (this is CancellationException) throw this }
}
