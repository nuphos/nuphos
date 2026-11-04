package ai.nuphos.android.data

import ai.nuphos.android.model.TeamMember
import kotlinx.serialization.Serializable

/** Who in the team may open the session without an invite. Only a chat offers [Reply]. */
@Serializable
enum class GeneralAccess(val title: String) {
    @kotlinx.serialization.SerialName("none") Invited("Only people invited"),
    @kotlinx.serialization.SerialName("view") View("Team can view"),
    @kotlinx.serialization.SerialName("reply") Reply("Team can view and reply");
    val raw get() = when (this) { Invited -> "none"; View -> "view"; Reply -> "reply" }
}

@Serializable
data class SessionAccess(val generalAccess: GeneralAccess, val participants: List<Participant>) {
    /** `role` is `owner`, `reply`, or `view` for someone who cannot use the session's computer yet. */
    @Serializable
    data class Participant(val id: String, val name: String, val email: String, val isOwner: Boolean,
        val role: String? = null, val avatarURL: String? = null, val deactivated: Boolean = false) {
        val displayName get() = name.ifBlank { email.ifBlank { "Unknown user" } }
        val canReply get() = role != "view"
        val roleTitle get() = if (canReply) "Can reply" else "Can view"
    }
}

/** Every mutation returns the complete authoritative access document. */
interface SharingTransport {
    suspend fun read(): SessionAccess
    suspend fun members(): List<TeamMember>
    suspend fun general(value: GeneralAccess): SessionAccess
    /**
     * The backend answers 409 while an invitee cannot use the session's computer,
     * until [grantComputerUse] confirms giving them `use` of it. It is always sent:
     * a request without it comes from a release that predates asking.
     */
    suspend fun invite(userId: String, grantComputerUse: Boolean): SessionAccess
    suspend fun remove(userId: String): SessionAccess
}

class SessionSharingApi(private val token: String, private val team: String, session: String,
    private val request: suspend (String, String, String, List<Pair<String, String>>, JsonValue?) -> String = AgentChatApi::send,
) : SharingTransport {
    private val path = "agent/conversations/${segment(session)}"
    private val query = listOf("teamId" to team)
    private suspend fun access(method: String, suffix: String, body: JsonValue? = null): SessionAccess =
        try { Http.json.decodeFromString<SessionAccess>(request(method, "$path/$suffix", token, query, body)) }
        catch (e: kotlinx.serialization.SerializationException) { throw NuphosApi.Failure.InvalidResponse }
    override suspend fun read() = access("GET", "participants")
    override suspend fun members() = NuphosApi.teamMembers(token, team, includeRemoved = false)
    override suspend fun general(value: GeneralAccess) = access("PATCH", "access", JsonValue.obj("generalAccess" to JsonValue.Str(value.raw)))
    override suspend fun invite(userId: String, grantComputerUse: Boolean) = access("POST", "participants", JsonValue.obj(
        "userIds" to JsonValue.Arr(listOf(JsonValue.Str(userId))), "grantComputerUse" to JsonValue.Bool(grantComputerUse)))
    override suspend fun remove(userId: String) = access("DELETE", "participants/${segment(userId)}")
    companion object {
        private fun segment(value: String) = java.net.URLEncoder.encode(value, "UTF-8").replace("+", "%20")
    }
}
