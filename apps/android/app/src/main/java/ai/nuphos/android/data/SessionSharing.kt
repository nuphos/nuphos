package ai.nuphos.android.data

import ai.nuphos.android.model.TeamMember
import kotlinx.serialization.Serializable

@Serializable
enum class GeneralAccess(val title: String, val floor: Int) {
    @kotlinx.serialization.SerialName("none") Invited("Only people invited", 0),
    @kotlinx.serialization.SerialName("view") View("Team can view", 1),
    @kotlinx.serialization.SerialName("reply") Reply("Team can view and reply", 2);
    val raw get() = when (this) { Invited -> "none"; View -> "view"; Reply -> "reply" }
}

enum class ShareRole(val raw: String, val title: String, val rank: Int) {
    Manage("manage", "Can manage", 3), Reply("reply", "Can reply", 2), View("view", "Can view", 1)
}

@Serializable
data class SessionAccess(val generalAccess: GeneralAccess, val participants: List<Participant>) {
    @Serializable
    data class Participant(val id: String, val name: String, val email: String, val isOwner: Boolean,
        val role: String? = null, val avatarURL: String? = null, val deactivated: Boolean = false) {
        val displayName get() = name.ifBlank { email.ifBlank { "Unknown user" } }
        fun effectiveRole(general: GeneralAccess): ShareRole {
            val own = ShareRole.entries.firstOrNull { it.raw == role } ?: ShareRole.View
            return if (own.rank >= general.floor) own else ShareRole.entries.first { it.rank == general.floor }
        }
    }
}

/** Every mutation returns the complete authoritative access document. */
interface SharingTransport {
    suspend fun read(): SessionAccess
    suspend fun members(): List<TeamMember>
    val localRuntime: Boolean
    suspend fun general(value: GeneralAccess): SessionAccess
    suspend fun invite(userId: String, role: ShareRole): SessionAccess
    suspend fun role(userId: String, role: ShareRole): SessionAccess
    suspend fun remove(userId: String): SessionAccess
}

class SessionSharingApi(private val token: String, private val team: String, session: String,
    private val runtimeId: String?,
    private val request: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
) : SharingTransport {
    private val path = "agent/conversations/${segment(session)}"
    private val query = listOf("teamId" to team)
    private suspend fun access(method: String, suffix: String, body: JsonValue? = null): SessionAccess =
        try { Http.json.decodeFromString<SessionAccess>(request(method, "$path/$suffix", token, query, body)) }
        catch (e: kotlinx.serialization.SerializationException) { throw NuphosApi.Failure.InvalidResponse }
    override suspend fun read() = access("GET", "participants")
    override suspend fun members() = NuphosApi.teamMembers(token, team, includeRemoved = false)
    // Local addresses remain stable when their computer is offline and absent from the catalog.
    override val localRuntime get() = runtimeId?.startsWith("local_") == true
    override suspend fun general(value: GeneralAccess) = access("PATCH", "access", JsonValue.obj("generalAccess" to JsonValue.Str(value.raw)))
    override suspend fun invite(userId: String, role: ShareRole) = access("POST", "participants", JsonValue.obj(
        "userIds" to JsonValue.Arr(listOf(JsonValue.Str(userId))), "role" to JsonValue.Str(role.raw)))
    override suspend fun role(userId: String, role: ShareRole) = access("PATCH", "participants/${segment(userId)}", JsonValue.obj("role" to JsonValue.Str(role.raw)))
    override suspend fun remove(userId: String) = access("DELETE", "participants/${segment(userId)}")
    companion object {
        private fun segment(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    }
}
