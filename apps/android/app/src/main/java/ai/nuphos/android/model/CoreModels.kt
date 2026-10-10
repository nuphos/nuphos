package ai.nuphos.android.model

import kotlinx.serialization.Serializable

@Serializable
data class NuphosUser(
    val id: String,
    val email: String = "",
    val name: String = "",
    val username: String = "",
    val avatarURL: String = "",
) {
    val displayName: String
        get() = name.ifEmpty { username.ifEmpty { email } }

    val avatar: String?
        get() = avatarURL.takeIf { it.isNotEmpty() }

    val initials: String
        get() {
            val parts = displayName.split(Regex("\\s+")).filter { it.isNotEmpty() }
            val first = parts.firstOrNull() ?: return "?"
            return if (parts.size == 1) {
                first.take(2).uppercase()
            } else {
                (first.take(1) + parts.last().take(1)).uppercase()
            }
        }

    companion object {
        val preview = NuphosUser(
            id = "507f1f77bcf86cd799439011",
            email = "bruce@example.com",
            name = "Bruce Wayne",
            username = "bruce",
            avatarURL = "",
        )
    }
}

@Serializable
data class Team(
    val id: String,
    val name: String = "",
    val avatarUrl: String? = null,
    val isOwner: Boolean? = null,
    val role: String? = null,
) {
    val isAdministrator: Boolean
        get() = role == "ADMINISTRATOR" || isOwner == true

    companion object {
        val preview = Team(id = "64b5f1c2e4b0a1d2c3e4f5a6", name = "Zeabur", isOwner = true)
    }
}

@Serializable
data class TeamsEnvelope(val teams: List<Team> = emptyList())

@Serializable
data class TeamMember(
    val id: String,
    val name: String = "",
    val email: String = "",
    val username: String = "",
    val avatarURL: String? = null,
    val role: String? = null,
    val removedAt: String? = null,
) {
    val displayName: String
        get() = name.ifEmpty { username.ifEmpty { email } }

    val isRemoved: Boolean get() = !removedAt.isNullOrEmpty()

    fun asUser(): NuphosUser = NuphosUser(
        id = id,
        email = email,
        name = name,
        username = username,
        avatarURL = avatarURL.orEmpty(),
    )
}

@Serializable
data class TeamMembersEnvelope(val members: List<TeamMember> = emptyList())

enum class HomePage(val title: String, val route: String) {
    Agent("Agent", "agent"),
    Monitoring("Monitoring", "monitoring"),
    Triggers("Triggers", "triggers"),
    Plans("Plans", "plans"),
    Connectors("Connectors", "connectors");

    companion object {
        fun fromRoute(raw: String?): HomePage =
            entries.firstOrNull { it.route == raw } ?: Agent
    }
}

enum class ConversationScope(val raw: String) {
    Mine("mine"),
    Team("team"),
}
