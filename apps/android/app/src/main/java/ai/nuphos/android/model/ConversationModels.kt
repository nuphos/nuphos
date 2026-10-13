package ai.nuphos.android.model

import ai.nuphos.android.data.Instants
import ai.nuphos.android.data.JsonValue
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import java.time.Instant

object InstantAsStringSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("Instant", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(value.toString())
    override fun deserialize(decoder: Decoder): Instant =
        Instants.parse(decoder.decodeString()) ?: Instant.EPOCH
}

object InstantAsStringSerializerNullable : KSerializer<Instant?> {
    private val delegate = String.serializer().nullable
    override val descriptor = delegate.descriptor
    override fun serialize(encoder: Encoder, value: Instant?) =
        delegate.serialize(encoder, value?.toString())
    override fun deserialize(decoder: Decoder): Instant? =
        Instants.parse(delegate.deserialize(decoder))
}

@Serializable
data class AgentConversation(
    val sessionId: String,
    val teamId: String? = null,
    val title: String = "",
    val firstMessage: String = "",
    val messageCount: Int = 0,
    @Serializable(with = InstantAsStringSerializer::class)
    val createdAt: Instant = Instant.EPOCH,
    @Serializable(with = InstantAsStringSerializer::class)
    val lastActiveAt: Instant = Instant.EPOCH,
    @Serializable(with = InstantAsStringSerializerNullable::class)
    val archivedAt: Instant? = null,
    val owner: Owner? = null,
    val isOwner: Boolean? = null,
    val readOnly: Boolean? = null,
    val tokenUsage: TokenUsage? = null,
    val activitySource: ActivitySource? = null,
    val activeRun: JsonValue? = null,
    val runtimeState: JsonValue? = null,
    val activitySeq: JsonValue? = null,
    val readSeq: JsonValue? = null,
    val unread: JsonValue? = null,
) {
    @Transient
    val id: String get() = sessionId

    val displayTitle: String
        get() = title.ifEmpty { firstMessage.ifEmpty { "Untitled chat" } }

    val isArchived: Boolean get() = archivedAt != null

    @Serializable
    data class Owner(
        val id: String,
        val name: String? = null,
        val email: String? = null,
        val avatarURL: String? = null,
        val deactivated: Boolean? = null,
    ) {
        val displayName: String
            get() = name?.takeIf { it.isNotEmpty() } ?: email?.takeIf { it.isNotEmpty() } ?: "User"
    }

    @Serializable
    data class TokenUsage(val costUsd: Double? = null)

    @Serializable
    data class ActivitySource(
        val origin: String,
        val linkedSlackThread: Boolean? = null,
    )
}

@Serializable
data class AgentConversationsPage(
    val conversations: List<AgentConversation> = emptyList(),
    val nextCursor: String? = null,
    val hasMore: Boolean = false,
)

@Serializable
data class AgentConversationDetail(
    val messages: List<ChatMessage> = emptyList(),
    val messagesFirstIndex: Int? = null,
    val activeRun: ActiveRun? = null,
    val readOnly: Boolean? = null,
    val isOwner: Boolean? = null,
    val canCancelRun: Boolean? = null,
    val canRespondToRun: Boolean? = null,
    val agentRuntime: String? = null,
    val runtimeId: String? = null,
    val runtimeLabel: String? = null,
    val runtimeState: JsonValue? = null,
    val transcriptUpdatedAt: String? = null,
    val activitySeq: JsonValue? = null,
    val readSeq: JsonValue? = null,
    val unread: JsonValue? = null,
    val title: String? = null,
    @Serializable(with = InstantAsStringSerializerNullable::class)
    val archivedAt: Instant? = null,
    val credentialAccess: JsonValue? = null,
) {
    @Serializable
    data class ActiveRun(
        val streamId: String,
        val startedAt: String? = null,
    )
}

enum class HistoryTime {
    ;

    companion object {
        fun format(instant: Instant, now: Instant = Instant.now()): String {
            val seconds = maxOf(0L, now.epochSecond - instant.epochSecond)
            val minutes = (seconds / 60).toInt()
            if (minutes < 1) return "now"
            if (minutes < 60) return "$minutes min"
            val hours = minutes / 60
            if (hours < 24) return plural(hours, "hr")
            val days = hours / 24
            if (days < 30) return plural(days, "day")
            val months = days / 30
            if (months < 12) return plural(months, "mo")
            return plural(months / 12, "yr")
        }

        private fun plural(n: Int, unit: String) = "$n $unit${if (n == 1) "" else "s"}"
    }
}

object ChatTime {
    const val SEPARATOR_SECONDS = 5 * 60L

    fun label(date: Instant, now: Instant = Instant.now()): String {
        val seconds = now.epochSecond - date.epochSecond
        if (seconds < 60) return "Just now"
        val minutes = (seconds / 60).toInt()
        if (minutes < 60) return "$minutes min ago"
        val hours = minutes / 60
        if (hours <= 3) return "$hours hr ago"
        val time = java.time.format.DateTimeFormatter.ofLocalizedTime(java.time.format.FormatStyle.SHORT)
            .withZone(java.time.ZoneId.systemDefault())
            .format(date)
        val zone = java.time.ZoneId.systemDefault()
        val days = java.time.temporal.ChronoUnit.DAYS.between(
            date.atZone(zone).toLocalDate(),
            now.atZone(zone).toLocalDate(),
        ).toInt()
        return when (days) {
            0 -> time
            1 -> "Yesterday $time"
            2 -> "2 days ago $time"
            else -> {
                val sameYear = date.atZone(zone).year == now.atZone(zone).year
                val day = if (sameYear) {
                    java.time.format.DateTimeFormatter.ofPattern("MM/dd").withZone(zone).format(date)
                } else {
                    java.time.format.DateTimeFormatter.ofPattern("MM/dd/yyyy").withZone(zone).format(date)
                }
                if (sameYear) "$time, $day" else "$time $day"
            }
        }
    }

    fun showsTimestamp(date: Instant?, previous: Instant?): Boolean {
        if (date == null) return false
        if (previous == null) return true
        return date.epochSecond - previous.epochSecond > SEPARATOR_SECONDS
    }
}

object PlanLink {
    data class Target(val teamId: String, val planId: String)

    fun target(url: String): Target? = runCatching { target(java.net.URI(url)) }.getOrNull()

    fun target(uri: java.net.URI): Target? {
        val host = uri.host?.lowercase()
        if (host != null) {
            if (host != "nuphos.ai" && !host.endsWith(".nuphos.ai")) return null
        } else if (uri.scheme != null) {
            return null
        }
        val parts = uri.path.orEmpty().trim('/').split('/').filter { it.isNotEmpty() }
        if (parts.size < 4 || parts[0] != "teams" || parts[2] != "plans") return null
        if (parts[1].isEmpty() || parts[3].isEmpty()) return null
        return Target(parts[1], parts[3])
    }
}
