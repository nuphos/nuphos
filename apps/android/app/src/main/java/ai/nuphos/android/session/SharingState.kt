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
    var localRuntime by mutableStateOf<Boolean?>(null); private set
    var loadError by mutableStateOf<String?>(null); private set
    var membersError by mutableStateOf<String?>(null); private set
    var runtimeError by mutableStateOf<String?>(null); private set
    var error by mutableStateOf<String?>(null); private set
    var pending by mutableStateOf<String?>(null); private set
    var added by mutableStateOf<TeamMember?>(null); private set
    var loading by mutableStateOf(false); private set
    val editable get() = canManage && access != null && pending == null
    val canInvite get() = editable && localRuntime != null
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
                launch {
                    runtimeError = null
                    try { localRuntime = transport.localRuntime() } catch (e: Exception) { e.rethrowCancellation(); runtimeError = e.message ?: "Couldn't load Agent details." }
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
    suspend fun role(person: SessionAccess.Participant, value: ShareRole): Boolean {
        if (person.isOwner || access?.participants?.none { it.id == person.id } != false || value.rank < (access?.generalAccess?.floor ?: 0)) return false
        return change(person.id) { transport.role(person.id, value) }
    }
    suspend fun remove(person: SessionAccess.Participant): Boolean {
        if (person.isOwner) return false
        return change(person.id) { transport.remove(person.id) }
    }
    suspend fun invite(member: TeamMember, role: ShareRole): Boolean {
        if (!canInvite || member.isRemoved || access?.participants?.any { it.id == member.id } == true) return false
        return change(member.id) { transport.invite(member.id, role) }.also { if (it) added = member }
    }
    suspend fun undo() {
        val member = added ?: return
        if (change(member.id) { transport.remove(member.id) }) added = null
    }
    private fun Exception.rethrowCancellation() { if (this is CancellationException) throw this }
}
